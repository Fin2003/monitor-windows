#include "monitor_dashboard.h"
#include "monitor_theme.h"
#include "monitor_ui.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

LV_IMG_DECLARE(dashboard_tibo_avatar);

/* Default layout (no overview slots from the host): quota card top-left, two sensor cards below it, Radar
 * column on the right. Otherwise the host sends "layout": the Windows overview's slot packing for 1024x600. */
enum { LEFT_W = 660, CODING_H = 272, SENSOR_Y = UI_MARGIN + CODING_H + UI_GAP, RADAR_X = UI_MARGIN + LEFT_W + UI_GAP, RADAR_W = 1024 - RADAR_X - UI_MARGIN };
enum { POST_GAP = 10, MAX_POSTS = 3, MAX_CODING = 4, MAX_SENSORS = 6 };

static lv_obj_t *panel;
static cJSON *last_data, *layout;
static bool last_minmax = true, online = true;
static char radar_post_ids[MAX_POSTS][40];
static int radar_posts_shown;

/* The Coding Plan card fits the overview grid in three shapes: wide (2x1 cells), tall (1x2) and single. */
typedef enum { CODING_WIDE, CODING_TALL, CODING_SINGLE } coding_shape_t;
typedef struct {
    lv_obj_t *name, *rings[3], *labels[3], *values[3], *details[3], *center;
    ui_status_t status;
    coding_shape_t shape;
} coding_card_t;
static coding_card_t codings[MAX_CODING], previews[3];
static int coding_count, coding_ref[MAX_CODING];
static bool preview_shapes; /* simulator: the three coding shapes replace the dashboard */
static ui_sensor_card_t sensors[MAX_SENSORS];
static int sensor_count, sensor_ref[MAX_SENSORS];
static struct {
    bool built;
    const lv_font_t *big;
    lv_obj_t *type, *age, *at, *badge, *outlook, *outlook_detail;
    lv_obj_t *posts[MAX_POSTS], *post_text[MAX_POSTS], *post_tag[MAX_POSTS], *post_at[MAX_POSTS], *post_hits[MAX_POSTS];
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

/* Rings for the three periods (5 hours / week / month) beside or above the rows; single cells keep the rows.
 * title: font for the card name (the slot's 文字 scale). Rows tighten on short cells so all three fit. */
static void build_coding(coding_card_t *c, int x, int y, int w, int h, const lv_font_t *title) {
    const ui_palette_t *p = ui_pal();
    memset(c, 0, sizeof(*c));
    /* Shape by proportion: a 横双格 slot is 490-660 px wide depending on the grid; rings need about 250 px of height. */
    c->shape = w >= 460 && w * 10 >= h * 14 && h >= 250 ? CODING_WIDE : h >= 450 && w >= 280 ? CODING_TALL : CODING_SINGLE;
    lv_obj_t *card = ui_card(panel, x, y, w, h);
    c->name = ui_label(card, UI_PAD, 14, w - 2 * UI_PAD - 96, title->line_height, title, p->text, LV_TEXT_ALIGN_LEFT);
    ui_status_build(&c->status, card, w - UI_PAD, 20);
    const uint32_t colors[] = {p->blue, p->violet, p->amber};
    bool wide = c->shape == CODING_WIDE, tall = c->shape == CODING_TALL;
    if (wide || tall) {
        int diameter = wide ? 192 : 240, gx = wide ? UI_PAD : (w - diameter) / 2;
        for (int i = 0; i < 3; i++) c->rings[i] = ui_ring(card, gx + 22 * i, 62 + 22 * i, diameter - 44 * i, 16, 270, colors[i]);
        c->center = ui_label(card, gx + 55, 62 + diameter / 2 - 18, diameter - 110, 36, &ui_font_26b, p->text, LV_TEXT_ALIGN_CENTER);
    }
    int left = wide ? 250 : UI_PAD, row_width = w - left - UI_PAD, top = tall ? 330 : 66;
    int pitch = (h - top - 8) / 3;
    if (pitch > 58) pitch = 58;
    for (int i = 0; i < 3; i++) {
        int row_y = top + pitch * i;
        c->labels[i] = caption(card, left, row_y, row_width / 2, "额度", colors[i]);
        c->values[i] = ui_label(card, left + row_width / 2, row_y - 3, row_width / 2, 36, &ui_font_26b, colors[i], LV_TEXT_ALIGN_RIGHT);
        /* The countdown line needs a full row; short cells show the percentages only. */
        if (pitch >= 52) c->details[i] = ui_label(card, left, row_y + 27, row_width, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    }
}

/* "Last reset" + "current status" stacked at (x, y) inside the card; returns the y below them. */
static int radar_sections(lv_obj_t *card, int card_w, int x, int y, int w, const lv_font_t *big, bool roomy) {
    const ui_palette_t *p = ui_pal();
    const int big_h = big->line_height, section = 30 + big_h + 24 + (roomy ? 24 : 10);
    caption(card, x, y + 12, 150, "最近重置", 0);
    radar.type = ui_chip(card, 0, y + 8, 32, p->green);
    lv_obj_align(radar.type, LV_ALIGN_TOP_RIGHT, x + w - card_w, y + 8);
    radar.age = ui_label(card, x, y + 34, w, big_h, big, p->text, LV_TEXT_ALIGN_LEFT);
    radar.at = ui_label(card, x, y + 34 + big_h, w, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    int status = y + section;
    ui_hairline(card, x, status - 2, w);
    caption(card, x, status + 12, 150, "当前状态", 0);
    radar.badge = ui_chip(card, 0, status + 8, 32, p->amber);
    lv_obj_align(radar.badge, LV_ALIGN_TOP_RIGHT, x + w - card_w, status + 8);
    radar.outlook = ui_label(card, x, status + 34, w, big_h, big, p->text, LV_TEXT_ALIGN_LEFT);
    radar.outlook_detail = ui_label(card, x, status + 34 + big_h, w, 24, &ui_font_20m, p->text2, LV_TEXT_ALIGN_LEFT);
    return status + section;
}

/* Like the Windows overview: tall (1x2) = status above posts, wide (2x1) = status beside two posts,
 * single = status only. */
static void build_radar(int x, int y, int w, int h, const lv_font_t *title_font, const lv_font_t *big) {
    const ui_palette_t *p = ui_pal();
    radar.built = true; radar.big = big;
    lv_obj_t *card = ui_card(panel, x, y, w, h);
    lv_obj_t *avatar = lv_img_create(card); lv_obj_set_pos(avatar, UI_PAD, 16); lv_img_set_src(avatar, &dashboard_tibo_avatar); ui_passive(avatar);
    lv_obj_t *title = ui_label(card, UI_PAD + 42, 16, 150, title_font->line_height, title_font, p->text, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(title, "Tibo 雷达");
    ui_status_build(&radar.health, card, w - UI_PAD, 20);
    const bool wide = w >= 460 && w * 10 >= h * 14, tall = !wide && h >= 450;
    const int column = wide ? (w - 2 * UI_PAD - UI_GAP) / 2 : w - 2 * UI_PAD;
    int top = 56, below = radar_sections(card, w, UI_PAD, top, column, big, tall);
    int status_y = top + (below - top) / 2;
    ui_hit_area(panel, x, y + top, wide ? UI_PAD + column : w, status_y - top - 4, radar_hit, 0);
    ui_hit_area(panel, x, y + status_y, wide ? UI_PAD + column : w, below - status_y - 8, radar_hit, 1);

    int px = UI_PAD - 8, py = below, pw = column + 16, ph = h - below - UI_PAD + 4;
    if (wide) { px = UI_PAD + column + UI_GAP - 8; py = top; ph = h - top - UI_PAD + 4; }
    int count = wide ? 2 : tall ? (ph >= 3 * 104 + 2 * POST_GAP ? 3 : 2) : 0;
    if (count && ph < count * 80) count = ph >= 80 ? 1 : 0;
    radar_posts_shown = count;
    const int post_h = count ? (ph - (count - 1) * POST_GAP) / count : 0;
    for (int i = 0; i < count; i++) {
        int py_i = py + i * (post_h + POST_GAP);
        radar.posts[i] = ui_box(card, px, py_i, pw, post_h, p->surface2, UI_RADIUS_S);
        radar.post_text[i] = ui_label(radar.posts[i], 14, 8, pw - 28, post_h - 40, &ui_font_20r, p->text, LV_TEXT_ALIGN_LEFT);
        lv_obj_set_style_text_line_space(radar.post_text[i], 2, 0);
        radar.post_tag[i] = ui_label(radar.posts[i], 14, post_h - 31, 140, 24, &ui_font_20m, p->text2, LV_TEXT_ALIGN_LEFT);
        radar.post_at[i] = ui_label(radar.posts[i], pw - 160, post_h - 31, 146, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_RIGHT);
        radar.post_hits[i] = ui_hit_area(panel, x + px, y + py_i, pw, post_h, radar_hit, 2 + i);
    }
}

static int json_int(cJSON *object, const char *key, int fallback) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(item) ? item->valueint : fallback;
}

static void build(void) {
    lv_obj_clean(panel);
    memset(&radar, 0, sizeof(radar));
    coding_count = sensor_count = radar_posts_shown = 0;
    lv_obj_set_style_bg_color(panel, lv_color_hex(ui_pal()->bg), 0);
    if (preview_shapes) {
        build_coding(&previews[0], UI_MARGIN, UI_MARGIN, LEFT_W, CODING_H, &ui_font_26b);
        build_coding(&previews[1], UI_MARGIN, SENSOR_Y, (LEFT_W - UI_GAP) / 2, 600 - UI_MARGIN - SENSOR_Y, &ui_font_26b);
        build_coding(&previews[2], RADAR_X, UI_MARGIN, RADAR_W, 600 - 2 * UI_MARGIN, &ui_font_26b);
        return;
    }
    if (!cJSON_GetArraySize(layout)) {
        build_coding(&codings[0], UI_MARGIN, UI_MARGIN, LEFT_W, CODING_H, &ui_font_26b);
        coding_ref[0] = 0; coding_count = 1;
        for (int i = 0; i < 2; i++) {
            ui_sensor_card_build(&sensors[i], panel, UI_MARGIN + i * ((LEFT_W + UI_GAP) / 2), SENSOR_Y, (LEFT_W - UI_GAP) / 2, 600 - UI_MARGIN - SENSOR_Y);
            sensor_ref[i] = i;
        }
        sensor_count = 2;
        build_radar(RADAR_X, UI_MARGIN, RADAR_W, 600 - 2 * UI_MARGIN, &ui_font_26b, &ui_font_44b);
        return;
    }
    /* Each entry is one card: k = c(oding) / s(ensor) / r(adar), i = index into codings[]/sensors[],
     * x/y/w/h in pixels, t/d = text and data sizes in px from the slot's scales (Windows formula). */
    cJSON *entry;
    cJSON_ArrayForEach(entry, layout) {
        const char *kind = str(entry, "k");
        int x = json_int(entry, "x", 0), y = json_int(entry, "y", 0), w = json_int(entry, "w", 0), h = json_int(entry, "h", 0);
        int t = json_int(entry, "t", 32), d = json_int(entry, "d", 44), ref = json_int(entry, "i", 0);
        if (w < 120 || h < 100 || x < 0 || y < 0 || x + w > 1024 || y + h > 600) continue;
        if (!strcmp(kind, "c") && coding_count < MAX_CODING) {
            build_coding(&codings[coding_count], x, y, w, h, ui_font_near(t, 20, 32));
            coding_ref[coding_count++] = ref;
        } else if (!strcmp(kind, "s") && sensor_count < MAX_SENSORS) {
            ui_sensor_card_build(&sensors[sensor_count], panel, x, y, w, h);
            ui_sensor_card_fonts(&sensors[sensor_count], ui_font_near(t, 20, 32), ui_font_near(d, 26, h < 200 ? 44 : 64));
            sensor_ref[sensor_count++] = ref;
        } else if (!strcmp(kind, "r") && !radar.built) {
            build_radar(x, y, w, h, ui_font_near(t, 20, 26), ui_font_near(d, 26, 44));
        }
    }
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
        if (c->details[i]) ui_set_text(c->details[i], str(period, "countdown"));
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
    /* "codings" holds one quota object per Coding slot; older hosts send only "coding". */
    cJSON *list = cJSON_GetObjectItemCaseSensitive(data, "codings");
    for (int i = 0; i < coding_count; i++) {
        cJSON *item = cJSON_GetArrayItem(list, coding_ref[i]);
        update_coding(&codings[i], item ? item : code, status, brief, dot, tone);
    }

    cJSON *items = cJSON_GetObjectItemCaseSensitive(data, "sensors");
    for (int i = 0; i < sensor_count; i++) ui_sensor_card_update(&sensors[i], cJSON_GetArrayItem(items, sensor_ref[i]), last_minmax);

    if (!radar.built) return;
    cJSON *r = cJSON_GetObjectItemCaseSensitive(data, "radar");
    const char *health = str(r, "health"), *kind = str(r, "healthKind");
    uint32_t health_color = !strcmp(kind,"active") ? p->green : !strcmp(kind,"error") ? p->red : !strcmp(kind,"warning") ? p->amber : p->text3;
    ui_status_set(&radar.health, health, health_color, p->text2);
    const char *type = str(r, "type");
    ui_chip_set(radar.type, strcmp(type, "--") ? type : "", !strcmp(type, "Banked") ? p->violet : p->green);
    ui_set_text(radar.age, *str(r, "age") ? str(r, "age") : "--");
    ui_set_text(radar.at, str(r, "at"));
    ui_chip_set(radar.badge, str(r, "state"), badge_color(str(r, "state")));
    ui_fit_font(radar.outlook, *str(r, "outlook") ? str(r, "outlook") : "--", radar.big, ui_font_smaller(radar.big));
    cJSON *late = cJSON_GetObjectItemCaseSensitive(r, "outlookLate");
    ui_set_text(radar.outlook_detail, str(r, "outlookDetail"));
    ui_set_color(radar.outlook_detail, cJSON_IsTrue(late) ? p->red : p->amber);
    cJSON *posts = cJSON_GetObjectItemCaseSensitive(r, "posts");
    for (int i = 0; i < radar_posts_shown; i++) {
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
    /* Rebuild only when the slot layout changes (the Windows overview settings), not on every frame. */
    cJSON *next = cJSON_GetObjectItemCaseSensitive(data, "layout");
    if (!(next == NULL && layout == NULL) && !(next && layout && cJSON_Compare(next, layout, true))) {
        if (layout) cJSON_Delete(layout);
        layout = next ? cJSON_Duplicate(next, true) : NULL;
        build();
    }
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
