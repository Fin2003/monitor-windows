#include "monitor_pages.h"
#include "monitor_theme.h"
#include "monitor_ui.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

LV_IMG_DECLARE(dashboard_tibo_avatar);

enum { PAGE_NONE, PAGE_CODING, PAGE_SYSTEM, PAGE_RADAR };
enum { HALF_W = (1024 - 2 * UI_MARGIN - UI_GAP) / 2, RIGHT_X = UI_MARGIN + HALF_W + UI_GAP };
static lv_obj_t *panel;
static cJSON *last_data;
static int active_page;
static bool online_state = true, last_minmax = true;

static const char *str(cJSON *object, const char *key) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : "";
}
static double number(cJSON *object, const char *key) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(item) && isfinite(item->valuedouble) ? item->valuedouble : NAN;
}
static const char *or_dash(const char *text) { return text && *text ? text : "--"; }
static void percent_text(lv_obj_t *label, double value) {
    char text[16];
    if (isfinite(value)) snprintf(text, sizeof(text), "%.0f%%", value); else snprintf(text, sizeof(text), "--");
    ui_set_text(label, text);
}
static void sync_panel_opacity(void) {
    if (!panel) return;
    lv_opa_t target = online_state ? LV_OPA_COVER : LV_OPA_60;
    if (lv_obj_get_style_opa(panel, 0) != target) lv_obj_set_style_opa(panel, target, 0);
}
static lv_obj_t *caption(lv_obj_t *parent, int x, int y, int w, const char *text) {
    lv_obj_t *label = ui_label(parent, x, y, w, 24, &ui_font_20r, ui_pal()->text2, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(label, text);
    return label;
}
/* Value followed by a smaller unit, bottom-aligned, e.g. "2" + "时". */
typedef struct { lv_obj_t *row, *value, *unit; } value_unit_t;
static value_unit_t value_unit(lv_obj_t *parent, const lv_font_t *font, uint32_t color) {
    value_unit_t v;
    v.row = lv_obj_create(parent); lv_obj_remove_style_all(v.row); ui_passive(v.row);
    lv_obj_set_size(v.row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(v.row, LV_FLEX_FLOW_ROW); lv_obj_set_flex_align(v.row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    lv_obj_set_style_pad_column(v.row, 6, 0);
    v.value = lv_label_create(v.row); lv_obj_set_style_text_font(v.value, font, 0); lv_obj_set_style_text_color(v.value, lv_color_hex(color), 0); lv_label_set_text(v.value, ""); ui_passive(v.value);
    v.unit = lv_label_create(v.row); lv_obj_set_style_text_font(v.unit, &ui_font_26b, 0); lv_obj_set_style_text_color(v.unit, lv_color_hex(ui_pal()->text2), 0); lv_label_set_text(v.unit, ""); ui_passive(v.unit);
    lv_obj_set_style_pad_bottom(v.unit, font->base_line - ui_font_26b.base_line, 0);
    return v;
}

/* ---------------- Coding ---------------- */

enum { GAUGE = 296, STROKE = 18, RING_STEP = STROKE + 6, GAUGE_Y = 68, LEGEND_Y = 380, LEGEND_ROW = 56 };
typedef struct { lv_obj_t *name, *pct, *detail; } legend_row_t;
static struct {
    lv_obj_t *name[2], *rings[2][3];
    value_unit_t center[2];
    legend_row_t rows[2][3];
} coding;
static void build_coding(void) {
    const ui_palette_t *p = ui_pal();
    memset(&coding, 0, sizeof(coding));
    const int gauge_x = (HALF_W - GAUGE) / 2;
    const uint32_t colors[] = {p->blue, p->violet, p->amber};
    for (int c = 0; c < 2; c++) {
        lv_obj_t *card = ui_card(panel, c ? RIGHT_X : UI_MARGIN, UI_MARGIN, HALF_W, 600 - 2 * UI_MARGIN);
        coding.name[c] = ui_label(card, UI_PAD, 16, HALF_W - 2 * UI_PAD, 32, &ui_font_26b, p->text, LV_TEXT_ALIGN_LEFT);
        for (int i = 0; i < 3; i++) {
            coding.rings[c][i] = ui_ring(card, gauge_x + i * RING_STEP, GAUGE_Y + i * RING_STEP, GAUGE - 2 * i * RING_STEP, STROKE, 270, colors[i]);
            int y = LEGEND_Y + i * LEGEND_ROW;
            if (i) ui_hairline(card, UI_PAD, y - 1, HALF_W - 2 * UI_PAD);
            ui_dot(card, UI_PAD, y + 23, 10, colors[i]);
            coding.rows[c][i].name = ui_label(card, UI_PAD + 22, y + 15, 130, 26, &ui_font_20r, p->text, LV_TEXT_ALIGN_LEFT);
            coding.rows[c][i].pct = ui_label(card, HALF_W - UI_PAD - 100, y + 11, 100, 32, &ui_font_26b, colors[i], LV_TEXT_ALIGN_RIGHT);
            coding.rows[c][i].detail = ui_label(card, 164, y + 17, HALF_W - UI_PAD - 100 - 164, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_RIGHT);
        }
        caption(card, gauge_x, GAUGE_Y + GAUGE / 2 - 50, GAUGE, "下次刷新");
        coding.center[c] = value_unit(card, &ui_font_64b, p->text);
        lv_obj_align(coding.center[c].row, LV_ALIGN_TOP_MID, 0, GAUGE_Y + GAUGE / 2 - 26);
    }
}
static void update_coding(cJSON *data) {
    cJSON *cards = cJSON_GetObjectItemCaseSensitive(data, "cards");
    for (int c = 0; c < 2; c++) {
        cJSON *card = cJSON_GetArrayItem(cards, c);
        ui_set_text(coding.name[c], *str(card, "name") ? str(card, "name") : "Coding Plan");
        cJSON *periods = cJSON_GetObjectItemCaseSensitive(card, "periods");
        for (int i = 0; i < 3; i++) {
            cJSON *period = cJSON_GetArrayItem(periods, i);
            double pct = number(period, "pct");
            ui_ring_value(coding.rings[c][i], pct);
            percent_text(coding.rows[c][i].pct, pct);
            ui_set_text(coding.rows[c][i].name, or_dash(str(period, "label")));
            ui_set_text(coding.rows[c][i].detail, str(period, "countdown"));
        }
        cJSON *center = cJSON_GetObjectItemCaseSensitive(card, "center");
        ui_set_text(coding.center[c].value, or_dash(str(center, "value")));
        ui_set_text(coding.center[c].unit, str(center, "unit"));
    }
}

/* ---------------- System ---------------- */

static struct { lv_obj_t *backend; ui_status_t updated; ui_sensor_card_t sensors[6]; } system_ui;

static void build_system(void) {
    const ui_palette_t *p = ui_pal();
    memset(&system_ui, 0, sizeof(system_ui));
    lv_obj_t *title = ui_label(panel, UI_MARGIN + 4, 14, 120, 32, &ui_font_26b, p->text, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(title, "系统监控");
    system_ui.backend = ui_label(panel, UI_MARGIN + 124, 22, 520, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    ui_status_build(&system_ui.updated, panel, 1024 - UI_MARGIN - 4, 22);
    const int top = 60, w = (1024 - 2 * UI_MARGIN - 2 * UI_GAP) / 3, h = (600 - top - UI_MARGIN - UI_GAP) / 2;
    for (int i = 0; i < 6; i++) {
        int column = i % 3, row = i / 3, x = UI_MARGIN + column * (w + UI_GAP);
        ui_sensor_card_build(&system_ui.sensors[i], panel, x, top + row * (h + UI_GAP), column == 2 ? 1024 - UI_MARGIN - x : w, h);
    }
}
static void update_system(cJSON *data, bool show_minmax) {
    const ui_palette_t *p = ui_pal();
    ui_set_text(system_ui.backend, str(data, "backend"));
    bool cached = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(data, "cached"));
    char updated[48]; snprintf(updated, sizeof(updated), "%s %s", cached ? "缓存" : "更新", or_dash(str(data, "updated")));
    ui_status_set(&system_ui.updated, updated, online_state ? (cached ? p->amber : p->green) : p->red, p->text2);
    cJSON *items = cJSON_GetObjectItemCaseSensitive(data, "sensors");
    for (int i = 0; i < 6; i++) ui_sensor_card_update(&system_ui.sensors[i], cJSON_GetArrayItem(items, i), show_minmax);
}

/* ---------------- Radar ---------------- */

enum { HERO_Y = 60, HERO_H = 164, TABS_Y = 236, CONTENT_Y = 288, CONTENT_H = 600 - UI_MARGIN - CONTENT_Y, POST_ROW = 92 };
typedef struct {
    lv_obj_t *card, *title, *status, *nodes[2], *captions[2], *values[2], *link, *quote_box, *quote;
    char post_id[40];
} radar_event_t;
typedef struct { lv_obj_t *card, *body, *tag, *date; char post_id[40]; } radar_post_t;
static struct {
    lv_obj_t *type, *recent_at, *badge, *outlook, *banks[2], *meta;
    lv_obj_t *events_tab, *posts_tab, *events_label, *posts_label, *posts_panel, *bank_row;
    lv_obj_t *event_hits[2], *post_hits[3];
    value_unit_t age;
    ui_status_t health;
    radar_event_t events[2];
    radar_post_t posts[3];
    bool posts_visible;
} radar_ui;

static void show_radar_posts(bool visible) {
    const ui_palette_t *p = ui_pal();
    radar_ui.posts_visible = visible;
    for (int i = 0; i < 2; i++) { ui_set_visible(radar_ui.events[i].card, !visible); ui_set_visible(radar_ui.event_hits[i], !visible); }
    ui_set_visible(radar_ui.posts_panel, visible);
    for (int i = 0; i < 3; i++) ui_set_visible(radar_ui.post_hits[i], visible && radar_ui.posts[i].post_id[0]);
    ui_set_bg(radar_ui.events_tab, visible ? p->surface : p->border); ui_set_bg(radar_ui.posts_tab, visible ? p->border : p->surface);
    ui_set_color(radar_ui.events_label, visible ? p->text2 : p->text); ui_set_color(radar_ui.posts_label, visible ? p->text : p->text2);
}
static void radar_touch(lv_event_t *event) {
    int code = (int)(intptr_t)lv_event_get_user_data(event);
    if (code == 0) monitor_ui_radar_recent_tap();
    else if (code == 1) monitor_ui_radar_status_tap();
    else if (code >= 2 && code < 4 && radar_ui.events[code - 2].post_id[0]) monitor_ui_request_radar_detail("post", radar_ui.events[code - 2].post_id);
    else if (code >= 10 && code < 13 && radar_ui.posts[code - 10].post_id[0]) monitor_ui_request_radar_detail("post", radar_ui.posts[code - 10].post_id);
    else if (code == 20) show_radar_posts(false);
    else if (code == 21) show_radar_posts(true);
}
static lv_obj_t *segment(lv_obj_t *parent, int x, const char *text, lv_obj_t **label) {
    lv_obj_t *tab = ui_box(parent, x, 4, 84, 32, ui_pal()->surface, 8);
    *label = ui_label(tab, 0, 5, 84, 22, &ui_font_20m, ui_pal()->text, LV_TEXT_ALIGN_CENTER);
    lv_label_set_text(*label, text);
    return tab;
}
static void build_radar_event(int index, int x) {
    const ui_palette_t *p = ui_pal();
    radar_event_t *e = &radar_ui.events[index];
    const int w = HALF_W, column = (w - 2 * UI_PAD) / 2;
    e->card = ui_card(panel, x, CONTENT_Y, w, CONTENT_H);
    e->title = ui_label(e->card, UI_PAD, 18, 260, 26, &ui_font_20r, p->text, LV_TEXT_ALIGN_LEFT);
    e->status = ui_chip(e->card, 0, 16, 32, p->amber);
    lv_obj_align(e->status, LV_ALIGN_TOP_RIGHT, -UI_PAD, 16);
    e->link = ui_box(e->card, UI_PAD + 60, 80, column - 72, 2, p->border, 1);
    for (int i = 0; i < 2; i++) {
        int cx = UI_PAD + i * column;
        e->nodes[i] = ui_dot(e->card, cx, 75, 12, p->text3);
        e->captions[i] = ui_label(e->card, cx + 20, 70, 48, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_LEFT);
        e->values[i] = ui_label(e->card, cx, 100, column - 8, 42, &ui_font_44b, p->text, LV_TEXT_ALIGN_LEFT);
    }
    e->quote_box = ui_box(e->card, UI_PAD, CONTENT_H - UI_PAD - 96, w - 2 * UI_PAD, 96, p->surface2, UI_RADIUS_S);
    e->quote = ui_label(e->quote_box, 16, 14, w - 2 * UI_PAD - 56, 66, &ui_font_20r, p->text2, LV_TEXT_ALIGN_LEFT);
    lv_obj_set_style_text_line_space(e->quote, 2, 0);
    lv_obj_t *chevron = ui_label(e->quote_box, w - 2 * UI_PAD - 34, 36, 20, 24, &lv_font_montserrat_14, p->text3, LV_TEXT_ALIGN_CENTER);
    lv_label_set_text(chevron, LV_SYMBOL_RIGHT);
}
static void build_radar(void) {
    const ui_palette_t *p = ui_pal();
    memset(&radar_ui, 0, sizeof(radar_ui));
    lv_obj_t *avatar = lv_img_create(panel); lv_obj_set_pos(avatar, UI_MARGIN + 4, 14); lv_img_set_src(avatar, &dashboard_tibo_avatar); ui_passive(avatar);
    lv_obj_t *title = ui_label(panel, UI_MARGIN + 46, 14, 200, 32, &ui_font_26b, p->text, LV_TEXT_ALIGN_LEFT);
    lv_label_set_text(title, "Tibo 雷达");
    ui_status_build(&radar_ui.health, panel, 1024 - UI_MARGIN - 4, 22);

    lv_obj_t *recent = ui_card(panel, UI_MARGIN, HERO_Y, HALF_W, HERO_H);
    caption(recent, UI_PAD, 18, 200, "最近重置");
    radar_ui.type = ui_chip(recent, 0, 14, 32, p->green);
    lv_obj_align(radar_ui.type, LV_ALIGN_TOP_RIGHT, -UI_PAD, 14);
    radar_ui.age = value_unit(recent, &ui_font_64b, p->text);
    lv_obj_set_pos(radar_ui.age.row, UI_PAD, 46);
    lv_obj_set_style_text_color(radar_ui.age.unit, lv_color_hex(p->text), 0);
    radar_ui.recent_at = ui_label(recent, UI_PAD, HERO_H - 40, 140, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    radar_ui.bank_row = lv_obj_create(recent); lv_obj_remove_style_all(radar_ui.bank_row); ui_passive(radar_ui.bank_row);
    lv_obj_set_size(radar_ui.bank_row, LV_SIZE_CONTENT, 32); lv_obj_align(radar_ui.bank_row, LV_ALIGN_BOTTOM_RIGHT, -UI_PAD, -14);
    lv_obj_set_flex_flow(radar_ui.bank_row, LV_FLEX_FLOW_ROW); lv_obj_set_style_pad_column(radar_ui.bank_row, 8, 0);
    for (int i = 0; i < 2; i++) radar_ui.banks[i] = ui_chip(radar_ui.bank_row, 0, 0, 32, p->violet);

    lv_obj_t *status = ui_card(panel, RIGHT_X, HERO_Y, HALF_W, HERO_H);
    caption(status, UI_PAD, 18, 200, "当前状态");
    radar_ui.badge = ui_chip(status, 0, 14, 32, p->amber);
    lv_obj_align(radar_ui.badge, LV_ALIGN_TOP_RIGHT, -UI_PAD, 14);
    radar_ui.outlook = ui_label(status, UI_PAD, 46, HALF_W - 2 * UI_PAD, 63, &ui_font_64b, p->amber, LV_TEXT_ALIGN_LEFT);
    radar_ui.meta = ui_label(status, UI_PAD, HERO_H - 40, HALF_W - 2 * UI_PAD, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);

    lv_obj_t *tabs = ui_box(panel, UI_MARGIN, TABS_Y, 176, 40, p->surface, UI_RADIUS_S);
    radar_ui.events_tab = segment(tabs, 4, "事件", &radar_ui.events_label);
    radar_ui.posts_tab = segment(tabs, 88, "帖子", &radar_ui.posts_label);

    build_radar_event(0, UI_MARGIN); build_radar_event(1, RIGHT_X);
    radar_ui.posts_panel = ui_box(panel, UI_MARGIN, CONTENT_Y, 1024 - 2 * UI_MARGIN, CONTENT_H, p->bg, 0);
    lv_obj_set_style_bg_opa(radar_ui.posts_panel, LV_OPA_TRANSP, 0);
    const int post_w = 1024 - 2 * UI_MARGIN, post_h = (CONTENT_H - 2 * 10) / 3;
    for (int i = 0; i < 3; i++) {
        radar_post_t *post = &radar_ui.posts[i];
        post->card = ui_card(radar_ui.posts_panel, 0, i * (post_h + 10), post_w, post_h);
        post->body = ui_label(post->card, UI_PAD, 14, post_w - 2 * UI_PAD - 40, 26, &ui_font_20r, p->text, LV_TEXT_ALIGN_LEFT);
        post->tag = ui_label(post->card, UI_PAD, post_h - 36, 240, 22, &ui_font_20m, p->text2, LV_TEXT_ALIGN_LEFT);
        post->date = ui_label(post->card, post_w - UI_PAD - 40 - 220, post_h - 36, 220, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_RIGHT);
        lv_obj_t *chevron = ui_label(post->card, post_w - UI_PAD - 20, post_h / 2 - 10, 20, 20, &lv_font_montserrat_14, p->text3, LV_TEXT_ALIGN_CENTER);
        lv_label_set_text(chevron, LV_SYMBOL_RIGHT);
    }
    ui_hit_area(panel, UI_MARGIN, HERO_Y, HALF_W, HERO_H, radar_touch, 0);
    ui_hit_area(panel, RIGHT_X, HERO_Y, HALF_W, HERO_H, radar_touch, 1);
    ui_hit_area(panel, UI_MARGIN + 4, TABS_Y + 4, 84, 32, radar_touch, 20);
    ui_hit_area(panel, UI_MARGIN + 88, TABS_Y + 4, 84, 32, radar_touch, 21);
    for (int i = 0; i < 2; i++) radar_ui.event_hits[i] = ui_hit_area(panel, i ? RIGHT_X : UI_MARGIN, CONTENT_Y, HALF_W, CONTENT_H, radar_touch, 2 + i);
    for (int i = 0; i < 3; i++) radar_ui.post_hits[i] = ui_hit_area(panel, UI_MARGIN, CONTENT_Y + i * (post_h + 10), post_w, post_h, radar_touch, 10 + i);
    show_radar_posts(false);
}
static void update_radar(cJSON *data) {
    const ui_palette_t *p = ui_pal();
    const char *health = or_dash(str(data, "health"));
    ui_status_set(&radar_ui.health, health, ui_health_color(health), p->text2);
    const char *type = str(data, "recentType");
    ui_chip_set(radar_ui.type, strcmp(type, "--") ? type : "", !strcmp(type, "Banked") ? p->violet : p->green);
    cJSON *age = cJSON_GetObjectItemCaseSensitive(data, "age");
    ui_set_text(radar_ui.age.value, or_dash(str(age, "number"))); ui_set_text(radar_ui.age.unit, str(age, "unit"));
    ui_set_text(radar_ui.recent_at, str(data, "recentAt"));
    uint32_t tone = ui_tone(str(data, "tone"));
    ui_chip_set(radar_ui.badge, str(data, "badge"), tone);
    ui_set_color(radar_ui.outlook, tone == p->text2 ? p->text : tone);
    ui_fit_font(radar_ui.outlook, or_dash(str(data, "outlook")), &ui_font_64b, &ui_font_44b);
    cJSON *banks = cJSON_GetObjectItemCaseSensitive(data, "banks");
    for (int i = 0; i < 2; i++) {
        cJSON *bank = cJSON_GetArrayItem(banks, i); char text[48] = "";
        if (cJSON_IsString(bank)) snprintf(text, sizeof(text), "Banked %s", bank->valuestring);
        ui_chip_set(radar_ui.banks[i], text, p->violet);
    }
    char meta[96]; snprintf(meta, sizeof(meta), "%s · %s", or_dash(str(data, "updated")), or_dash(str(data, "timezone")));
    ui_set_text(radar_ui.meta, meta);

    cJSON *items = cJSON_GetObjectItemCaseSensitive(data, "events");
    for (int i = 0; i < 2; i++) {
        cJSON *item = cJSON_GetArrayItem(items, i); radar_event_t *e = &radar_ui.events[i];
        uint32_t color = ui_tone(str(item, "tone"));
        bool done = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(item, "done"));
        snprintf(e->post_id, sizeof(e->post_id), "%s", str(item, "postId"));
        char title[48]; snprintf(title, sizeof(title), "Reset · %s", or_dash(str(item, "date")));
        ui_set_text(e->title, title);
        ui_chip_set(e->status, str(item, "status"), color);
        ui_set_text(e->captions[0], str(item, "forecastLabel")); ui_set_text(e->captions[1], str(item, "completionLabel"));
        int link_x = UI_PAD + 20 + ui_text_width(&ui_font_20r, str(item, "forecastLabel")) + 12;
        lv_obj_set_x(e->link, link_x); lv_obj_set_width(e->link, UI_PAD + (HALF_W - 2 * UI_PAD) / 2 - 12 - link_x);
        const char *values[] = {str(item, "forecastValue"), str(item, "completionValue")};
        for (int k = 0; k < 2; k++) {
            bool empty = !*values[k] || !strcmp(values[k], "—") || !strcmp(values[k], "--:--");
            bool lit = k == 0 ? !empty : done;
            ui_fit_font(e->values[k], empty ? "—" : values[k], &ui_font_44b, &ui_font_26b);
            ui_set_color(e->values[k], empty ? p->text3 : (lit ? color : p->text));
            ui_set_bg(e->nodes[k], lit ? color : p->border);
        }
        ui_set_bg(e->link, done ? color : p->border);
        const char *quote = str(item, "quote");
        ui_set_text_clean(e->quote, *quote ? quote : "暂无相关帖子");
        ui_set_visible(e->quote_box, true);
    }
    cJSON *posts = cJSON_GetObjectItemCaseSensitive(data, "posts");
    for (int i = 0; i < 3; i++) {
        cJSON *item = cJSON_GetArrayItem(posts, i); radar_post_t *post = &radar_ui.posts[i];
        snprintf(post->post_id, sizeof(post->post_id), "%s", str(item, "id"));
        ui_set_text_clean(post->body, str(item, "text"));
        const char *tag = str(item, "tag");
        ui_set_text(post->tag, *tag ? tag : "帖子"); ui_set_color(post->tag, *tag ? ui_tone(str(item, "tone")) : p->text3);
        ui_set_text(post->date, str(item, "at"));
        ui_set_bg(post->card, ui_post_bg(tag, str(item, "tone"), p->surface));
        ui_set_visible(post->card, post->post_id[0]);
    }
    show_radar_posts(radar_ui.posts_visible);
}

/* ---------------- Page switching ---------------- */

static int page_type(cJSON *data) {
    const char *type = str(data, "type");
    if (!strcmp(type, "coding")) return PAGE_CODING;
    if (!strcmp(type, "system")) return PAGE_SYSTEM;
    if (!strcmp(type, "radar")) return PAGE_RADAR;
    return PAGE_NONE;
}
static bool render(cJSON *data, bool rebuild) {
    int type = page_type(data);
    if (type == PAGE_NONE || !panel) return false;
    if (rebuild || type != active_page) {
        lv_obj_clean(panel); active_page = type;
        lv_obj_set_style_bg_color(panel, lv_color_hex(ui_pal()->bg), 0);
        if (type == PAGE_CODING) build_coding(); else if (type == PAGE_SYSTEM) build_system(); else build_radar();
    }
    if (type == PAGE_CODING) update_coding(data); else if (type == PAGE_SYSTEM) update_system(data, last_minmax); else update_radar(data);
    sync_panel_opacity();
    return true;
}

lv_obj_t *monitor_pages_create(lv_obj_t *parent) {
    panel = lv_obj_create(parent); lv_obj_remove_style_all(panel);
    lv_obj_set_pos(panel, 0, 0); lv_obj_set_size(panel, 1024, 600);
    lv_obj_set_style_bg_color(panel, lv_color_hex(ui_pal()->bg), 0); lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    ui_passive(panel);
    return panel;
}
bool monitor_pages_apply(cJSON *data, bool show_minmax) {
    if (!cJSON_IsObject(data) || page_type(data) == PAGE_NONE) return false;
    cJSON *copy = cJSON_Duplicate(data, true);
    if (!copy) return false;
    if (last_data) cJSON_Delete(last_data);
    last_data = copy; last_minmax = show_minmax;
    return render(data, false);
}
void monitor_pages_show(bool visible) { ui_set_visible(panel, visible); }
void monitor_pages_status(bool online) {
    if (online_state == online) return;
    online_state = online;
    if (last_data) render(last_data, false); else sync_panel_opacity();
}
void monitor_pages_theme(bool dark) {
    static int built_dark = -1;
    if (built_dark == (int)dark) return;
    built_dark = dark;
    if (last_data) render(last_data, true);
    else if (panel) lv_obj_set_style_bg_color(panel, lv_color_hex(ui_pal()->bg), 0);
}
