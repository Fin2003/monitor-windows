#include "monitor_dashboard.h"
#include "monitor_theme.h"
#include "monitor_ui.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

LV_IMG_DECLARE(dashboard_tibo_avatar);

/* Layout: quota card top-left, two sensor cards below it, Radar column on the right. */
enum { LEFT_W = 660, CODING_H = 272, SENSOR_Y = UI_MARGIN + CODING_H + UI_GAP, RADAR_X = UI_MARGIN + LEFT_W + UI_GAP, RADAR_W = 1024 - RADAR_X - UI_MARGIN };
enum { RADAR_RESETS_Y = 56, RADAR_STATUS_Y = 176, RADAR_POSTS_Y = 300, POST_COUNT = 2, POST_GAP = 10,
       POST_H = (600 - 2 * UI_MARGIN - RADAR_POSTS_Y - UI_PAD + 4 - (POST_COUNT - 1) * POST_GAP) / POST_COUNT };

static lv_obj_t *panel;
static cJSON *last_data;
static bool last_minmax = true, online = true;
static char radar_post_ids[3][40];

typedef enum { CODING_WIDE, CODING_TALL, CODING_SINGLE } coding_shape_t;
typedef struct {
    lv_obj_t *name, *rings[3], *labels[3], *values[3], *details[3], *center;
    ui_status_t status;
    coding_shape_t shape;
} coding_card_t;
static coding_card_t coding, previews[3];
static bool preview_shapes; /* simulator: the three coding shapes replace the dashboard */
static ui_sensor_card_t sensors[2];
static struct {
    lv_obj_t *type, *age, *at, *badge, *outlook, *outlook_detail;
    lv_obj_t *posts[3], *post_text[3], *post_tag[3], *post_at[3], *post_hits[3];
    ui_status_t health;
} radar;

static const char *str(cJSON *object, const char *key) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : "";
}
static double number(cJSON *object, const char *key) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(item) && isfinite(item->valuedouble) ? item->valuedouble : NAN;
}
static void percent_text(lv_obj_t *label, double value) {
    char text[16];
    if (isfinite(value)) snprintf(text, sizeof(text), "%.0f%%", value); else snprintf(text, sizeof(text), "--");
    ui_set_text(label, text);
}

static void radar_hit(lv_event_t *event) {
    int code = (int)(intptr_t)lv_event_get_user_data(event);
    if (code == 0) monitor_ui_radar_recent_tap();
    else if (code == 1) monitor_ui_radar_status_tap();
    else if (code >= 2 && code < 5 && radar_post_ids[code - 2][0]) monitor_ui_request_radar_detail("post", radar_post_ids[code - 2]);
}

static lv_obj_t *caption(lv_obj_t *parent, int x, int y, int w, const char *text, uint32_t dot) {
    int offset = 0;
    if (dot) { ui_dot(parent, x, y + 8, 10, dot); offset = 18; }
    lv_obj_t *label = ui_label(parent, x + offset, y, w - offset, 24, &ui_font_20r, ui_pal()->text2, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(label, text);
    return label;
}

static void build_coding(coding_card_t *c, int x, int y, int w, int h) {
    const ui_palette_t *p = ui_pal();
    memset(c, 0, sizeof(*c));
    c->shape = w >= 500 ? CODING_WIDE : h >= 450 ? CODING_TALL : CODING_SINGLE;
    lv_obj_t *card = ui_card(panel, x, y, w, h);
    c->name = ui_label(card, UI_PAD, 14, w - 2 * UI_PAD - 96, 35, &ui_font_26b, p->text, LV_TEXT_ALIGN_LEFT);
    ui_status_build(&c->status, card, w - UI_PAD, 20);
    const uint32_t colors[] = {p->blue, p->violet, p->amber};
    bool wide = c->shape == CODING_WIDE, tall = c->shape == CODING_TALL;
    if (wide || tall) {
        int diameter = wide ? 192 : 240, gx = wide ? UI_PAD : (w - diameter) / 2;
        for (int i = 0; i < 3; i++) c->rings[i] = ui_ring(card, gx + 22 * i, 62 + 22 * i, diameter - 44 * i, 16, 270, colors[i]);
        c->center = ui_label(card, gx + 55, 62 + diameter / 2 - 18, diameter - 110, 36, &ui_font_26b, p->text, LV_TEXT_ALIGN_CENTER);
    }
    int left = wide ? 250 : UI_PAD, row_width = w - left - UI_PAD, top = tall ? 330 : 66;
    for (int i = 0; i < 3; i++) {
        int row_y = top + 58 * i;
        c->labels[i] = caption(card, left, row_y, row_width / 2, "额度", colors[i]);
        c->values[i] = ui_label(card, left + row_width / 2, row_y - 3, row_width / 2, 36, &ui_font_26b, colors[i], LV_TEXT_ALIGN_RIGHT);
        c->details[i] = ui_label(card, left, row_y + 27, row_width, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    }
}

static void build_radar(void) {
    const ui_palette_t *p = ui_pal();
    lv_obj_t *card = ui_card(panel, RADAR_X, UI_MARGIN, RADAR_W, 600 - 2 * UI_MARGIN);
    lv_obj_t *avatar = lv_img_create(card); lv_obj_set_pos(avatar, UI_PAD, 16); lv_img_set_src(avatar, &dashboard_tibo_avatar); ui_passive(avatar);
    lv_obj_t *title = ui_label(card, UI_PAD + 42, 16, 150, 32, &ui_font_26b, p->text, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(title, "Tibo 雷达");
    ui_status_build(&radar.health, card, RADAR_W - UI_PAD, 20);

    caption(card, UI_PAD, RADAR_RESETS_Y + 12, 150, "最近重置", 0);
    radar.type = ui_chip(card, 0, RADAR_RESETS_Y + 8, 32, p->green);
    lv_obj_align(radar.type, LV_ALIGN_TOP_RIGHT, -UI_PAD, RADAR_RESETS_Y + 8);
    radar.age = ui_label(card, UI_PAD, RADAR_RESETS_Y + 38, RADAR_W - 2 * UI_PAD, 50, &ui_font_44b, p->text, LV_TEXT_ALIGN_LEFT);
    radar.at = ui_label(card, UI_PAD, RADAR_RESETS_Y + 90, RADAR_W - 2 * UI_PAD, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    ui_hairline(card, UI_PAD, RADAR_STATUS_Y - 2, RADAR_W - 2 * UI_PAD);

    caption(card, UI_PAD, RADAR_STATUS_Y + 12, 150, "当前状态", 0);
    radar.badge = ui_chip(card, 0, RADAR_STATUS_Y + 8, 32, p->amber);
    lv_obj_align(radar.badge, LV_ALIGN_TOP_RIGHT, -UI_PAD, RADAR_STATUS_Y + 8);
    radar.outlook = ui_label(card, UI_PAD, RADAR_STATUS_Y + 36, RADAR_W - 2 * UI_PAD, 50, &ui_font_44b, p->text, LV_TEXT_ALIGN_LEFT);
    radar.outlook_detail = ui_label(card, UI_PAD, RADAR_STATUS_Y + 88, RADAR_W - 2 * UI_PAD, 24, &ui_font_20m, p->text2, LV_TEXT_ALIGN_LEFT);

    for (int i = 0; i < POST_COUNT; i++) {
        int y = RADAR_POSTS_Y + i * (POST_H + POST_GAP);
        radar.posts[i] = ui_box(card, UI_PAD - 8, y, RADAR_W - 2 * UI_PAD + 16, POST_H, p->surface2, UI_RADIUS_S);
        radar.post_text[i] = ui_label(radar.posts[i], 14, 8, RADAR_W - 2 * UI_PAD - 12, POST_H - 40, &ui_font_20r, p->text, LV_TEXT_ALIGN_LEFT);
        lv_obj_set_style_text_line_space(radar.post_text[i], 2, 0);
        radar.post_tag[i] = ui_label(radar.posts[i], 14, POST_H - 31, 140, 24, &ui_font_20m, p->text2, LV_TEXT_ALIGN_LEFT);
        radar.post_at[i] = ui_label(radar.posts[i], RADAR_W - 2 * UI_PAD - 146, POST_H - 31, 146, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_RIGHT);
    }
    ui_hit_area(panel, RADAR_X, UI_MARGIN + RADAR_RESETS_Y, RADAR_W, RADAR_STATUS_Y - RADAR_RESETS_Y - 4, radar_hit, 0);
    ui_hit_area(panel, RADAR_X, UI_MARGIN + RADAR_STATUS_Y, RADAR_W, RADAR_POSTS_Y - RADAR_STATUS_Y - 8, radar_hit, 1);
    for (int i = 0; i < POST_COUNT; i++)
        radar.post_hits[i] = ui_hit_area(panel, RADAR_X + UI_PAD - 8, UI_MARGIN + RADAR_POSTS_Y + i * (POST_H + POST_GAP), RADAR_W - 2 * UI_PAD + 16, POST_H, radar_hit, 2 + i);
}

static void build(void) {
    lv_obj_clean(panel);
    memset(&radar, 0, sizeof(radar));
    lv_obj_set_style_bg_color(panel, lv_color_hex(ui_pal()->bg), 0);
    if (preview_shapes) {
        build_coding(&previews[0], UI_MARGIN, UI_MARGIN, LEFT_W, CODING_H);
        build_coding(&previews[1], UI_MARGIN, SENSOR_Y, (LEFT_W - UI_GAP) / 2, 600 - UI_MARGIN - SENSOR_Y);
        build_coding(&previews[2], RADAR_X, UI_MARGIN, RADAR_W, 600 - 2 * UI_MARGIN);
        return;
    }
    build_coding(&coding, UI_MARGIN, UI_MARGIN, LEFT_W, CODING_H);
    for (int i = 0; i < 2; i++) ui_sensor_card_build(&sensors[i], panel, UI_MARGIN + i * ((LEFT_W + UI_GAP) / 2), SENSOR_Y, (LEFT_W - UI_GAP) / 2, 600 - UI_MARGIN - SENSOR_Y);
    build_radar();
}

static uint32_t badge_color(const char *badge) {
    const ui_palette_t *p = ui_pal();
    if (strstr(badge, "等待") || strstr(badge, "预告")) return p->amber;
    if (strstr(badge, "Banked")) return p->violet;
    if (strstr(badge, "超时") || strstr(badge, "延迟")) return p->red;
    if (strstr(badge, "%") || strstr(badge, "完成") || strstr(badge, "已重置")) return p->green;
    return p->text2;
}

static void update_coding(coding_card_t *c, cJSON *code, const char *status, const char *status_short, uint32_t dot, uint32_t tone) {
    ui_set_text(c->name, *str(code, "name") ? str(code, "name") : "Coding Plan");
    ui_status_set(&c->status, c->shape == CODING_WIDE ? status : status_short, dot, tone);
    cJSON *periods = cJSON_GetObjectItemCaseSensitive(code, "periods");
    for (int i = 0; i < 3; i++) {
        cJSON *period = cJSON_GetArrayItem(periods, i);
        double pct = number(period, "pct");
        if (c->rings[i]) ui_ring_value(c->rings[i], pct);
        ui_set_text(c->labels[i], str(period, "label"));
        percent_text(c->values[i], pct);
        ui_set_text(c->details[i], str(period, "countdown"));
    }
    if (c->center) {
        cJSON *center = cJSON_GetObjectItemCaseSensitive(code, "center");
        char text[32]; snprintf(text, sizeof(text), "%s%s", str(center, "value"), str(center, "unit"));
        ui_set_text(c->center, text);
    }
}

static void status_text(char *text, size_t size, char *brief, size_t brief_size, int seconds) {
    if (!online) { snprintf(text, size, "USB 未连接"); snprintf(brief, brief_size, "未连接"); }
    else if (seconds < 0) { snprintf(text, size, "已连接"); snprintf(brief, brief_size, "已连接"); }
    else if (seconds < 60) { snprintf(text, size, "已连接 · %ds", seconds); snprintf(brief, brief_size, "%ds", seconds); }
    else if (seconds < 3600) { snprintf(text, size, "硬件数据 %d 分钟前", seconds / 60); snprintf(brief, brief_size, "%d 分钟前", seconds / 60); }
    else if (seconds < 86400) { snprintf(text, size, "硬件数据 %d 小时前", seconds / 3600); snprintf(brief, brief_size, "%d 小时前", seconds / 3600); }
    else { snprintf(text, size, "硬件数据 %d 天前", seconds / 86400); snprintf(brief, brief_size, "%d 天前", seconds / 86400); }
}

static void update(cJSON *data) {
    const ui_palette_t *p = ui_pal();
    cJSON *code = cJSON_GetObjectItemCaseSensitive(data, "coding");
    /* sourceAge is the age of the hardware readings; flag it once it is clearly stale. */
    cJSON *age = cJSON_GetObjectItemCaseSensitive(data, "sourceAge");
    int seconds = cJSON_IsNumber(age) ? age->valueint : -1;
    char status[48], brief[32];
    status_text(status, sizeof(status), brief, sizeof(brief), seconds);
    bool stale = seconds >= 60;
    uint32_t dot = !online ? p->red : stale ? p->amber : p->green, tone = stale ? p->amber : p->text2;
    if (preview_shapes) {
        for (int i = 0; i < 3; i++) update_coding(&previews[i], code, status, brief, dot, tone);
        return;
    }
    update_coding(&coding, code, status, brief, dot, tone);

    cJSON *items = cJSON_GetObjectItemCaseSensitive(data, "sensors");
    for (int i = 0; i < 2; i++) ui_sensor_card_update(&sensors[i], cJSON_GetArrayItem(items, i), last_minmax);

    cJSON *r = cJSON_GetObjectItemCaseSensitive(data, "radar");
    const char *health = *str(r, "health") ? str(r, "health") : "--";
    ui_status_set(&radar.health, health, ui_health_color(health), p->text2);
    const char *type = str(r, "type");
    ui_chip_set(radar.type, strcmp(type, "--") ? type : "", !strcmp(type, "Banked") ? p->violet : p->green);
    ui_set_text(radar.age, *str(r, "age") ? str(r, "age") : "--");
    ui_set_text(radar.at, str(r, "at"));
    ui_chip_set(radar.badge, str(r, "state"), badge_color(str(r, "state")));
    ui_fit_font(radar.outlook, *str(r, "outlook") ? str(r, "outlook") : "--", &ui_font_44b, &ui_font_32b);
    cJSON *late = cJSON_GetObjectItemCaseSensitive(r, "outlookLate");
    ui_set_text(radar.outlook_detail, str(r, "outlookDetail"));
    ui_set_color(radar.outlook_detail, cJSON_IsTrue(late) ? p->red : p->amber);
    cJSON *posts = cJSON_GetObjectItemCaseSensitive(r, "posts");
    for (int i = 0; i < POST_COUNT; i++) {
        cJSON *post = cJSON_GetArrayItem(posts, i);
        snprintf(radar_post_ids[i], sizeof(radar_post_ids[i]), "%s", str(post, "id"));
        ui_set_text_clean(radar.post_text[i], str(post, "text"));
        ui_set_text(radar.post_tag[i], *str(post, "tag") ? str(post, "tag") : "帖子");
        ui_set_color(radar.post_tag[i], *str(post, "tag") ? ui_tone(str(post, "tone")) : p->text3);
        ui_set_text(radar.post_at[i], str(post, "at"));
        ui_set_bg(radar.posts[i], ui_post_bg(str(post, "tag"), str(post, "tone"), p->surface2));
        ui_set_visible(radar.posts[i], post != NULL); ui_set_visible(radar.post_hits[i], radar_post_ids[i][0] != 0);
    }
}

lv_obj_t *monitor_dashboard_create(lv_obj_t *parent) {
    panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_set_pos(panel, 0, 0); lv_obj_set_size(panel, 1024, 600);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(panel, LV_OBJ_FLAG_GESTURE_BUBBLE | LV_OBJ_FLAG_EVENT_BUBBLE);
    build(); update(NULL);
    return panel;
}
void monitor_dashboard_apply(cJSON *data, bool show_minmax) {
    last_minmax = show_minmax;
    cJSON *copy = cJSON_Duplicate(data, true);
    if (copy) { if (last_data) cJSON_Delete(last_data); last_data = copy; }
    update(data);
}
void monitor_dashboard_status(bool value) {
    if (online == value) return;
    online = value;
    if (panel) lv_obj_set_style_opa(panel, online ? LV_OPA_COVER : LV_OPA_60, 0);
    if (last_data) update(last_data);
}
void monitor_dashboard_theme(bool dark) {
    static int built_dark = -1;
    if (!panel || built_dark == (int)dark) return;
    built_dark = dark;
    build(); update(last_data);
}
void monitor_dashboard_preview_coding_shapes(void) {
    preview_shapes = true;
    build(); update(last_data);
}
