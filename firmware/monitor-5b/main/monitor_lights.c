/* Uses ESP-IDF NimBLE APIs; command frames stay in the existing host lamp protocol. */
#include "monitor_lights.h"
#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/idf_additions.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"

typedef struct {
    int id, kind, count, airtime, target, peer_type;
    uint8_t data[3][64];
    uint8_t length[3];
} light_job_t;
typedef struct { int id, code, completed, instance, target; bool event; const char *stage; } light_reply_t;
enum { JOB_ADV, JOB_GATT, JOB_RELEASE, JOB_PING, JOB_MAINTAIN };
static QueueHandle_t gatt_jobs, adv_jobs, replies;
static SemaphoreHandle_t gatt_done;
static volatile bool synced, started, adv_busy, gatt_busy, connecting, maintain_gatt = true;
static volatile int init_code, gatt_code, init_phase;
static volatile int lamp1_error;
static volatile int connect_status, disconnect_reason, service_status, characteristic_status;
static volatile int peer_rssi, peer_event_type, connection_interval, connection_latency;
static uint32_t radio_boot;
static const char *gatt_failure_stage = "none";
static ble_addr_t last_peer;
static bool have_peer, known_peer;
static const char *gatt_stage = "idle";
static volatile unsigned scan_reports, scan_matches;
static uint8_t own_address;
static uint16_t connection = BLE_HS_CONN_HANDLE_NONE, write_handle, service_start, service_end;
static bool advertising_configured;
static const char *radio_stage = "init";
static int radio_instance = -1;
static int gap_event(struct ble_gap_event *event, void *arg);
/* NimBLE compares UUID widths; use the lamp's short-form services. */
static const ble_uuid16_t service_uuid = BLE_UUID16_INIT(0xae30);
static const ble_uuid16_t write_uuid = BLE_UUID16_INIT(0xae01);

static void finish_gatt(int code) { gatt_code = code; connecting = false; xSemaphoreGive(gatt_done); }
static int on_characteristic(uint16_t handle, const struct ble_gatt_error *error, const struct ble_gatt_chr *chr, void *arg) {
    if (handle != connection) return 0;
    characteristic_status = error->status;
    if (!error->status && chr) write_handle = chr->val_handle;
    if (error->status) finish_gatt(error->status == BLE_HS_EDONE && write_handle ? 0 : error->status);
    return 0;
}
static int on_service(uint16_t handle, const struct ble_gatt_error *error, const struct ble_gatt_svc *svc, void *arg) {
    if (handle != connection) return 0;
    service_status = error->status;
    if (!error->status && svc) { service_start = svc->start_handle; service_end = svc->end_handle; }
    if (error->status == BLE_HS_EDONE && service_start) {
        gatt_stage = "gatt_characteristic";
        int rc = ble_gattc_disc_chrs_by_uuid(handle, service_start, service_end, &write_uuid.u, on_characteristic, NULL);
        if (rc) finish_gatt(rc);
    } else if (error->status) finish_gatt(error->status);
    return 0;
}
static bool matches_lamp(const uint8_t *data, int length) {
    struct ble_hs_adv_fields fields;
    if (ble_hs_adv_parse_fields(&fields, data, length)) return false;
    if (fields.name_len) {
        char name[64]; int count = fields.name_len < 63 ? fields.name_len : 63;
        memcpy(name, fields.name, count); name[count] = 0;
        if (strstr(name, "JST-3194-CCT")) return true;
    }
    for (int i = 0; i + 2 < fields.mfg_data_len; i++) {
        if (fields.mfg_data[i] == 0x88 && fields.mfg_data[i+1] == 0x99 && fields.mfg_data[i+2] == 0x10) return true;
    }
    return false;
}
static int connect_peer(const ble_addr_t *address) {
    connecting = true;
    gatt_stage = "gatt_connect";
    int rc = ble_gap_connect(own_address, address, 10000, NULL, gap_event, NULL);
    if (rc) finish_gatt(rc);
    return rc;
}
static void found_lamp(const ble_addr_t *address, const uint8_t *data, int length, int rssi, int event_type) {
    scan_reports++;
    bool known = known_peer && !memcmp(address->val, last_peer.val, sizeof(last_peer.val));
    if (!maintain_gatt || connecting || (!known && !matches_lamp(data, length))) return;
    scan_matches++;
    peer_rssi = rssi; peer_event_type = event_type;
    /* Suppress DISC_COMPLETE while switching from scanning to connecting. */
    connecting = true;
    ble_gap_disc_cancel();
    last_peer = *address; have_peer = true; known_peer = true;
    connect_peer(address);
}
static int gap_event(struct ble_gap_event *event, void *arg) {
    switch (event->type) {
        case BLE_GAP_EVENT_DISC:
            found_lamp(&event->disc.addr, event->disc.data, event->disc.length_data, event->disc.rssi, event->disc.event_type); break;
        case BLE_GAP_EVENT_EXT_DISC:
            found_lamp(&event->ext_disc.addr, event->ext_disc.data, event->ext_disc.length_data, event->ext_disc.rssi, event->ext_disc.props); break;
        case BLE_GAP_EVENT_DISC_COMPLETE:
            if (!connecting) finish_gatt(BLE_HS_ETIMEOUT);
            break;
        case BLE_GAP_EVENT_CONNECT:
            connect_status = event->connect.status;
            if (event->connect.status) { finish_gatt(event->connect.status); break; }
            connection = event->connect.conn_handle;
            {
                struct ble_gap_conn_desc desc;
                if (!ble_gap_conn_find(connection, &desc)) {
                    connection_interval = desc.conn_itvl; connection_latency = desc.conn_latency;
                }
            }
            if (!maintain_gatt) { ble_gap_terminate(connection, BLE_ERR_REM_USER_CONN_TERM); break; }
            service_start = service_end = write_handle = 0;
            gatt_stage = "gatt_service";
            {
                int rc = ble_gattc_disc_svc_by_uuid(connection, &service_uuid.u, on_service, NULL);
                if (rc) finish_gatt(rc);
            }
            break;
        case BLE_GAP_EVENT_DISCONNECT:
            disconnect_reason = event->disconnect.reason;
            if (event->disconnect.conn.conn_handle != connection) break;
            connection = BLE_HS_CONN_HANDLE_NONE; write_handle = 0; connecting = false;
            finish_gatt(BLE_HS_ENOTCONN); break;
        case BLE_GAP_EVENT_CONN_UPDATE:
            if (event->conn_update.conn_handle == connection && !event->conn_update.status) {
                struct ble_gap_conn_desc desc;
                if (!ble_gap_conn_find(connection, &desc)) {
                    connection_interval = desc.conn_itvl; connection_latency = desc.conn_latency;
                }
            }
            break;
        default: break;
    }
    return 0;
}
static void on_sync(void) { init_code = ble_hs_id_infer_auto(0, &own_address); synced = !init_code; }
static void on_reset(int reason) {
    synced = false; advertising_configured = false;
    connection = BLE_HS_CONN_HANDLE_NONE; write_handle = 0;
    finish_gatt(BLE_HS_ENOTCONN);
}
static void host_task(void *arg) { nimble_port_run(); vTaskDeleteWithCaps(NULL); }
static int start_radio(void) {
    if (!started) {
        init_phase = 2;
        init_code = nimble_port_init();
        if (init_code) return init_code;
        started = true;
        ble_hs_cfg.sync_cb = on_sync;
        ble_hs_cfg.reset_cb = on_reset;
        init_phase = 3;
        if (xTaskCreatePinnedToCoreWithCaps(host_task, "monitor_ble_host", 6144, NULL, configMAX_PRIORITIES - 4, NULL, 0, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) return ESP_ERR_NO_MEM;
    }
    for (int i = 0; i < 200 && !synced; i++) vTaskDelay(pdMS_TO_TICKS(10));
    init_phase = 4;
    return synced ? 0 : BLE_HS_ETIMEOUT;
}
static int configure_advertising(void) {
    if (!advertising_configured) {
        for (int i = 0; i < 3; i++) {
            radio_instance = i; radio_stage = "adv_configure";
            struct ble_gap_ext_adv_params params = {
                .legacy_pdu = 1, .connectable = 1, .scannable = 1,
                .itvl_min = 0x20, .itvl_max = 0x30, .channel_map = 7,
                .own_addr_type = BLE_OWN_ADDR_RANDOM, .primary_phy = BLE_HCI_LE_PHY_1M,
                .secondary_phy = BLE_HCI_LE_PHY_1M, .tx_power = 127, .sid = i
            };
            int rc = ble_gap_ext_adv_configure(i, &params, NULL, gap_event, NULL);
            if (rc) return rc;
            radio_stage = "adv_address";
            const ble_addr_t address = { .type = BLE_ADDR_RANDOM, .val = {i+1,0,0,0x53,0xde,0xc0} };
            rc = ble_gap_ext_adv_set_addr(i, &address);
            if (rc) return rc;
        }
        advertising_configured = true;
    }
    radio_instance = -1; radio_stage = "idle";
    return 0;
}
static int advertise_rotation(const light_job_t *job, int rotation) {
    int configured = configure_advertising();
    if (configured) return configured;
    int rc = 0;
    for (int i = 0; i < 3 && !rc; i++) {
        radio_instance = i; radio_stage = "adv_data";
        int frame = i == 2 ? 2 : (rotation & 1);
        struct os_mbuf *data = ble_hs_mbuf_from_flat(job->data[frame], job->length[frame]);
        if (!data) { rc = BLE_HS_ENOMEM; break; }
        rc = ble_gap_ext_adv_set_data(i, data);
        if (!rc) { radio_stage = "adv_start"; rc = ble_gap_ext_adv_start(i, 0, 0); }
    }
    if (!rc) vTaskDelay(pdMS_TO_TICKS(200));
    for (int i = 0; i < 3; i++) if (ble_gap_ext_adv_active(i)) ble_gap_ext_adv_stop(i);
    return rc;
}
static void advertising_worker(void *arg) {
    light_job_t active[2], incoming;
    bool valid[2] = {false, false}, acknowledged[2] = {false, false};
    int rotations[2] = {0, 0}, next = 0;
    for (;;) {
        if (xQueueReceive(adv_jobs, &incoming, valid[0] || valid[1] ? 0 : portMAX_DELAY) == pdTRUE) {
            do {
                int slot = incoming.target;
                if (valid[slot] && !acknowledged[slot]) {
                    light_reply_t replaced = { .id = active[slot].id, .stage = "superseded", .instance = -1, .target = slot };
                    xQueueSend(replies, &replaced, portMAX_DELAY);
                }
                active[slot] = incoming; rotations[slot] = 0;
                valid[slot] = true; acknowledged[slot] = false;
            } while (xQueueReceive(adv_jobs, &incoming, 0) == pdTRUE);
        }
        int slot = valid[next] ? next : 1-next;
        next = 1-slot; adv_busy = true;
        int rc = start_radio();
        if (!rc) rc = advertise_rotation(&active[slot], rotations[slot]);
        rotations[slot]++;
        if (!acknowledged[slot] || rc) {
            light_reply_t reply = { .id = active[slot].id, .code = rc, .completed = rc ? 0 : 1,
                .instance = radio_instance, .target = slot, .event = acknowledged[slot],
                .stage = rc ? radio_stage : "broadcast_started" };
            xQueueSend(replies, &reply, portMAX_DELAY);
            acknowledged[slot] = true;
        }
        if (rc || rotations[slot] >= (active[slot].airtime + 199) / 200) valid[slot] = false;
        adv_busy = valid[0] || valid[1];
        if (!adv_busy) { radio_stage = "idle"; radio_instance = -1; }
    }
}
static int await_gatt(TickType_t timeout) {
    if (xSemaphoreTake(gatt_done, timeout) == pdTRUE) return gatt_code;
    return BLE_HS_ETIMEOUT;
}
static void close_incomplete_gatt(void) {
    ble_gap_disc_cancel(); ble_gap_conn_cancel();
    while (xSemaphoreTake(gatt_done, 0) == pdTRUE) {}
    if (connection != BLE_HS_CONN_HANDLE_NONE) {
        int rc = ble_gap_terminate(connection, BLE_ERR_REM_USER_CONN_TERM);
        if (!rc) xSemaphoreTake(gatt_done, pdMS_TO_TICKS(2000));
    }
    connecting = false;
    while (xSemaphoreTake(gatt_done, 0) == pdTRUE) {}
}
static int ensure_gatt(void) {
    if (connection != BLE_HS_CONN_HANDLE_NONE && write_handle) return 0;
    if (!maintain_gatt) return BLE_HS_ENOTCONN;
    while (xSemaphoreTake(gatt_done, 0) == pdTRUE) {}
    if (have_peer) {
        int rc = connect_peer(&last_peer);
        if (!rc) rc = await_gatt(pdMS_TO_TICKS(14000));
        if (!rc) return 0;
        gatt_failure_stage = gatt_stage;
        close_incomplete_gatt();
        have_peer = false;
        if (!maintain_gatt) return BLE_HS_ENOTCONN;
        while (xSemaphoreTake(gatt_done, 0) == pdTRUE) {}
    }
    connecting = false;
    gatt_stage = "gatt_scan";
    struct ble_gap_disc_params params = { .passive = 0, .itvl = 0x60, .window = 0x30, .filter_duplicates = 0 };
    int rc = ble_gap_disc(own_address, 6000, &params, gap_event, NULL);
    if (rc) return rc;
    rc = await_gatt(pdMS_TO_TICKS(20000));
    if (rc) {
        gatt_failure_stage = gatt_stage;
        close_incomplete_gatt();
        have_peer = false;
    }
    return rc;
}
static void gatt_worker(void *arg) {
    light_job_t job;
    int64_t retry_at = 0;
    for (;;) {
        if (xQueueReceive(gatt_jobs, &job, pdMS_TO_TICKS(100)) != pdTRUE) {
            if (maintain_gatt && synced && !init_code && !write_handle && esp_timer_get_time() >= retry_at) {
                gatt_busy = true; gatt_stage = "gatt_reconnect";
                lamp1_error = ensure_gatt();
                retry_at = esp_timer_get_time() + 1500000;
                gatt_busy = false; gatt_stage = "idle";
            }
            continue;
        }
        gatt_busy = true;
        light_reply_t reply = { .id = job.id, .instance = -1, .stage = "idle" };
        gatt_stage = "radio_ready";
        if (job.kind == JOB_RELEASE) {
            gatt_stage = "gatt_release";
            if (connection != BLE_HS_CONN_HANDLE_NONE) {
                while (xSemaphoreTake(gatt_done, 0) == pdTRUE) {}
                reply.code = ble_gap_terminate(connection, BLE_ERR_REM_USER_CONN_TERM);
                if (!reply.code && xSemaphoreTake(gatt_done, pdMS_TO_TICKS(2000)) != pdTRUE) reply.code = BLE_HS_ETIMEOUT;
            }
        } else if (job.kind == JOB_MAINTAIN) {
            if (job.length[0] == 6) {
                memcpy(last_peer.val, job.data[0], 6); last_peer.type = job.peer_type;
                have_peer = true; known_peer = true;
            }
            maintain_gatt = true; retry_at = 0;
        } else {
            reply.code = start_radio();
            if (!reply.code && job.kind == JOB_GATT) {
                maintain_gatt = true; gatt_stage = "gatt_connect";
                reply.code = ensure_gatt();
                for (int i = 0; i < job.count && !reply.code; i++) {
                    gatt_stage = "gatt_write";
                    reply.code = ble_gattc_write_no_rsp_flat(connection, write_handle, job.data[i], job.length[i]);
                    if (!reply.code) { reply.completed++; vTaskDelay(pdMS_TO_TICKS(60)); }
                }
            }
        }
        if (job.kind == JOB_GATT) lamp1_error = reply.code;
        reply.stage = reply.code ? gatt_stage : "complete";
        gatt_stage = "idle"; gatt_busy = false;
        xQueueSend(replies, &reply, portMAX_DELAY);
    }
}
void monitor_lights_init(void) {
    radio_boot = esp_random();
    gatt_jobs = xQueueCreate(8, sizeof(light_job_t)); adv_jobs = xQueueCreate(8, sizeof(light_job_t));
    replies = xQueueCreate(16, sizeof(light_reply_t));
    gatt_done = xSemaphoreCreateBinary();
    /* Controller/PHY initialization can write NVS; run it on app_main's internal stack. */
    init_phase = 1;
    init_code = start_radio();
    /* Reserve all advertising sets without transmitting any lamp packets. */
    if (!init_code) init_code = configure_advertising();
    xTaskCreateWithCaps(gatt_worker, "monitor_lamp1", 6144, NULL, 3, NULL, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    xTaskCreateWithCaps(advertising_worker, "monitor_broadcast", 6144, NULL, 3, NULL, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
static int decode_hex(const char *hex, uint8_t *bytes) {
    size_t length = strlen(hex);
    if (!length || length > 128 || length % 2) return 0;
    for (int i = 0; i < length / 2; i++) {
        unsigned byte; if (sscanf(hex + i*2, "%2x", &byte) != 1) return 0;
        bytes[i] = byte;
    }
    return length / 2;
}
bool monitor_lights_command(const char *json) {
    if (!strstr(json, "\"light\"")) return false;
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    cJSON *type = cJSON_GetObjectItem(root, "type"), *kind = cJSON_GetObjectItem(root, "kind"), *id = cJSON_GetObjectItem(root, "id");
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "light") || !cJSON_IsString(kind) || !cJSON_IsNumber(id)) { cJSON_Delete(root); return false; }
    light_job_t job = { .id = id->valueint, .airtime = 4000 };
    if (!strcmp(kind->valuestring, "adv")) job.kind = JOB_ADV;
    else if (!strcmp(kind->valuestring, "gatt")) job.kind = JOB_GATT;
    else if (!strcmp(kind->valuestring, "release")) job.kind = JOB_RELEASE;
    else if (!strcmp(kind->valuestring, "ping")) job.kind = JOB_PING;
    else if (!strcmp(kind->valuestring, "maintain")) job.kind = JOB_MAINTAIN;
    else { cJSON_Delete(root); return true; }
    cJSON *frames = cJSON_GetObjectItem(root, "packets");
    cJSON *target = cJSON_GetObjectItem(root, "target");
    job.target = cJSON_IsNumber(target) ? target->valueint : 0;
    job.count = cJSON_GetArraySize(frames);
    bool valid = job.kind >= JOB_RELEASE || (job.count >= 1 && job.count <= 3 && (job.kind != JOB_ADV || job.count == 3));
    if (job.kind == JOB_ADV && (job.target < 0 || job.target > 1)) valid = false;
    for (int i = 0; valid && i < job.count; i++) {
        cJSON *packet = cJSON_GetArrayItem(frames, i);
        valid = cJSON_IsString(packet) && (job.length[i] = decode_hex(packet->valuestring, job.data[i])) > 0;
        if (job.kind == JOB_ADV && job.length[i] != 31) valid = false;
    }
    if (valid && job.kind == JOB_MAINTAIN) {
        cJSON *peer = cJSON_GetObjectItem(root, "peer"), *peer_type = cJSON_GetObjectItem(root, "peerType");
        if (cJSON_IsString(peer) && strlen(peer->valuestring)) {
            job.length[0] = decode_hex(peer->valuestring, job.data[0]);
            valid = job.length[0] == 6;
            job.peer_type = cJSON_IsNumber(peer_type) ? peer_type->valueint : BLE_ADDR_PUBLIC;
        }
    }
    if (valid && job.kind == JOB_RELEASE) {
        maintain_gatt = false;
        ble_gap_disc_cancel(); ble_gap_conn_cancel();
        finish_gatt(BLE_HS_ENOTCONN);
    }
    if (valid && job.kind == JOB_MAINTAIN && job.length[0] == 6 && !write_handle) {
        ble_gap_disc_cancel(); ble_gap_conn_cancel();
        finish_gatt(BLE_HS_ENOTCONN);
    }
    if (!valid || xQueueSend(job.kind == JOB_ADV ? adv_jobs : gatt_jobs, &job, 0) != pdTRUE) {
        light_reply_t reply = { .id = job.id, .code = valid ? BLE_HS_EBUSY : BLE_HS_EINVAL };
        xQueueSend(replies, &reply, 0);
    }
    cJSON_Delete(root); return true;
}
bool monitor_lights_pop_reply(char *reply, size_t length) {
    light_reply_t result;
    if (xQueueReceive(replies, &result, 0) != pdTRUE) return false;
    snprintf(reply, length, "{\"v\":1,\"type\":\"%s\",\"id\":%d,\"ok\":%s,\"code\":%d,\"completed\":%d,\"stage\":\"%s\",\"instance\":%d,\"target\":%d}\n", result.event ? "light_event" : "light_result", result.id, result.code ? "false" : "true", result.code, result.completed, result.stage ? result.stage : "queue", result.instance, result.target);
    return true;
}
void monitor_lights_diagnostics(char *json, size_t length) {
    snprintf(json, length, "\"lightControl\":true,\"radioReady\":%s,\"radioBusy\":%s,\"radioError\":%d,\"radioPhase\":%d,\"lamp1Connected\":%s,\"lamp1Maintained\":%s,\"lamp1Error\":%d,\"radioStage\":\"%s\",\"radioInstance\":%d,\"scanReports\":%u,\"scanMatches\":%u,\"connectStatus\":%d,\"disconnectReason\":%d,\"serviceStatus\":%d,\"characteristicStatus\":%d,\"gattFailureStage\":\"%s\",\"peerType\":%d,\"connectionHandle\":%u,\"writeHandle\":%u,\"peerRssi\":%d,\"peerEventType\":%d,\"connectionInterval\":%d,\"connectionLatency\":%d,\"radioBoot\":%lu", synced && !init_code ? "true" : "false", adv_busy || gatt_busy ? "true" : "false", init_code, init_phase, connection != BLE_HS_CONN_HANDLE_NONE && write_handle ? "true" : "false", maintain_gatt ? "true" : "false", lamp1_error, gatt_busy ? gatt_stage : radio_stage, radio_instance, scan_reports, scan_matches, connect_status, disconnect_reason, service_status, characteristic_status, gatt_failure_stage, last_peer.type, connection, write_handle, peer_rssi, peer_event_type, connection_interval, connection_latency, (unsigned long)radio_boot);
}
