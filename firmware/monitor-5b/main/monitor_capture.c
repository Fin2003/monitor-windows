#include "monitor_capture.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_rgb.h"
#include "esp_lv_adapter.h"
#include "mbedtls/base64.h"
#include "mbedtls/sha256.h"
#include "esp_rom_crc.h"
#include "lvgl.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static esp_lcd_panel_handle_t capture_panel;
void monitor_capture_init(esp_lcd_panel_handle_t panel) { capture_panel=panel; }
/* Averages each 2x2 block of RGB565 pixels: the editor's live preview at a quarter of the bytes. */
static void downsample(const uint16_t *source, uint16_t *target) {
    for(int y=0;y<300;y++) {
        const uint16_t *a=source+(y*2)*1024,*b=a+1024;
        for(int x=0;x<512;x++) {
            uint16_t p[4]={a[x*2],a[x*2+1],b[x*2],b[x*2+1]};
            unsigned r=0,g=0,bl=0;
            for(int i=0;i<4;i++){r+=p[i]>>11;g+=(p[i]>>5)&63;bl+=p[i]&31;}
            target[y*512+x]=(uint16_t)(((r/4)<<11)|((g/4)<<5)|(bl/4));
        }
    }
}

/* Editor preview diffs: the host keeps the last image; only 32x15 tiles whose CRC changed are sent. */
enum { TILE_W = 32, TILE_H = 15, TILE_COLS = 512 / TILE_W, TILE_ROWS = 300 / TILE_H, TILE_COUNT = TILE_COLS * TILE_ROWS };
static uint32_t tile_crc[TILE_COUNT], next_crc[TILE_COUNT];
static bool tiles_valid;
static void copy_tile(const uint16_t *pixels, int index, uint16_t *tile) {
    int x = (index % TILE_COLS) * TILE_W, y = (index / TILE_COLS) * TILE_H;
    for (int row = 0; row < TILE_H; row++) memcpy(tile + row * TILE_W, pixels + (y + row) * 512 + x, TILE_W * 2);
}
static void send_tiles(int id, const uint16_t *pixels, bool full, monitor_send_fn send) {
    static uint16_t tile[TILE_W * TILE_H];
    static char line[1500];
    static unsigned char encoded[1400];
    if (!tiles_valid) full = true;
    int changed = 0;
    for (int i = 0; i < TILE_COUNT; i++) {
        copy_tile(pixels, i, tile);
        next_crc[i] = esp_rom_crc32_le(0, (const uint8_t *)tile, sizeof(tile));
        if (full || next_crc[i] != tile_crc[i]) changed++;
    }
    uint8_t digest[32]; char hash[65];
    mbedtls_sha256((const uint8_t *)pixels, 512 * 300 * 2, digest, 0);
    for (int i = 0; i < 32; i++) snprintf(hash + i * 2, 3, "%02x", digest[i]);
    snprintf(line, sizeof(line), "{\"v\":1,\"type\":\"capture_begin\",\"id\":%d,\"width\":512,\"height\":300,\"format\":\"rgb565le-tiles\",\"tileWidth\":%d,\"tileHeight\":%d,\"full\":%s,\"tiles\":%d,\"sha256\":\"%s\"}\n",
        id, TILE_W, TILE_H, full ? "true" : "false", changed, hash);
    bool ok = send(line);
    for (int i = 0, sent = 0; ok && i < TILE_COUNT; i++) {
        if (!full && next_crc[i] == tile_crc[i]) continue;
        copy_tile(pixels, i, tile);
        size_t length = 0;
        if (mbedtls_base64_encode(encoded, sizeof(encoded), &length, (const unsigned char *)tile, sizeof(tile)) != 0) { ok = false; break; }
        encoded[length] = 0;
        snprintf(line, sizeof(line), "{\"v\":1,\"type\":\"capture_tile\",\"id\":%d,\"index\":%d,\"data\":\"%s\"}\n", id, i, encoded);
        ok = send(line);
        if (++sent % 16 == 0) vTaskDelay(1);
    }
    /* Only trust the table once the host has every tile; a dropped line makes its checksum fail and it asks for a full frame. */
    tiles_valid = ok;
    if (ok) memcpy(tile_crc, next_crc, sizeof(tile_crc));
    if (ok) { snprintf(line, sizeof(line), "{\"v\":1,\"type\":\"capture_end\",\"id\":%d}\n", id); send(line); }
}

bool monitor_capture_command(const char *json, monitor_send_fn send) {
    cJSON *root=cJSON_Parse(json);
    if(!root) return false;
    cJSON *type=cJSON_GetObjectItemCaseSensitive(root,"type"),*version=cJSON_GetObjectItemCaseSensitive(root,"v");
    if(!cJSON_IsString(type)||strcmp(type->valuestring,"capture")||!cJSON_IsNumber(version)||version->valueint!=1) {cJSON_Delete(root);return false;}
    cJSON *request=cJSON_GetObjectItemCaseSensitive(root,"id"),*buffer=cJSON_GetObjectItemCaseSensitive(root,"buffer"),*scale_item=cJSON_GetObjectItemCaseSensitive(root,"scale");
    int id=cJSON_IsNumber(request)?request->valueint:0;
    int index=cJSON_IsNumber(buffer)?buffer->valueint:-1;
    /* scale 2: copy a half-size frame under the lock, then stream it without freezing the UI. */
    bool half=cJSON_IsNumber(scale_item)&&scale_item->valueint==2&&index>=0;
    bool tiles=half&&cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"tiles")),full=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"full"));
    cJSON_Delete(root);
    const int width=half?512:1024,height=half?300:600;
    const size_t bytes=(size_t)width*height*2;
    uint8_t *owned=index<0||half?heap_caps_malloc(bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT):NULL;
    uint8_t *pixels=owned;
    bool ok=false,locked=false;
    if((index>=0&&!half)||pixels) {
        if(esp_lv_adapter_lock(1000)==ESP_OK) {
            locked=true;
            if(index>=0&&index<3) {
                void *fb[3]={0};
                esp_err_t result=esp_lcd_rgb_panel_get_frame_buffer(capture_panel,index+1,&fb[0],&fb[1],&fb[2]);
                if(result==ESP_OK&&fb[index]) {
                    if(half) downsample(fb[index],(uint16_t *)pixels);
                    /* Full size: freeze LVGL writes during diagnostic readback; no duplicate full frame. */
                    else pixels=fb[index];
                    ok=true;
                }
            } else if(index==-1) {
                lv_img_dsc_t image={0};
                ok=lv_snapshot_take_to_buf(lv_scr_act(),LV_IMG_CF_TRUE_COLOR,&image,pixels,bytes)==LV_RES_OK;
            }
            if(owned||!ok){esp_lv_adapter_unlock();locked=false;}
        }
    }
    char line[1300];
    if(!ok) {
        free(owned);snprintf(line,sizeof(line),"{\"v\":1,\"type\":\"capture_error\",\"id\":%d,\"message\":\"snapshot unavailable\"}\n",id);send(line);return true;
    }
    if(tiles){send_tiles(id,(const uint16_t *)pixels,full,send);free(owned);return true;}
    uint8_t digest[32];char hash[65];
    mbedtls_sha256(pixels,bytes,digest,0);
    for(int i=0;i<32;i++) snprintf(hash+i*2,3,"%02x",digest[i]);
    snprintf(line,sizeof(line),"{\"v\":1,\"type\":\"capture_begin\",\"id\":%d,\"width\":%d,\"height\":%d,\"bytes\":%u,\"format\":\"rgb565le\",\"source\":\"%s\",\"buffer\":%d,\"sha256\":\"%s\"}\n",id,width,height,(unsigned)bytes,index<0?"device-lvgl-snapshot":"device-lcd-framebuffer",index,hash);
    ok=send(line);
    for(size_t offset=0;ok&&offset<bytes;offset+=768) {
        unsigned char encoded[1028];size_t length=0,n=bytes-offset;if(n>768)n=768;
        if(mbedtls_base64_encode(encoded,sizeof(encoded),&length,pixels+offset,n)!=0) {ok=false;break;}
        encoded[length]=0;
        snprintf(line,sizeof(line),"{\"v\":1,\"type\":\"capture_chunk\",\"id\":%d,\"offset\":%u,\"data\":\"%s\"}\n",id,(unsigned)offset,encoded);
        ok=send(line);
        if(offset%(768*32)==0)vTaskDelay(1);
    }
    if(locked)esp_lv_adapter_unlock();
    free(owned);
    if(ok) {snprintf(line,sizeof(line),"{\"v\":1,\"type\":\"capture_end\",\"id\":%d}\n",id);send(line);}
    return true;
}
