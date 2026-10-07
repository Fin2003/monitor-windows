#include "monitor_theme.h"
#include <math.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

static const ui_palette_t dark_palette = {
    .bg = 0x080c10, .surface = 0x181c20, .surface2 = 0x202428, .border = 0x283038,
    .text = 0xf0f4f8, .text2 = 0x98a0a8, .text3 = 0x687078,
    .blue = 0x4c9aff, .violet = 0x9d8cff, .amber = 0xffb23f, .orange = 0xff8a4c,
    .green = 0x3ecf8e, .red = 0xff6b66, .cyan = 0x3cc8dc,
};
static const ui_palette_t light_palette = {
    .bg = 0xf0f4f8, .surface = 0xffffff, .surface2 = 0xe8ecf0, .border = 0xd8dce0,
    .text = 0x101418, .text2 = 0x586068, .text3 = 0x889098,
    .blue = 0x1d6fe0, .violet = 0x6b55d6, .amber = 0xb26a00, .orange = 0xc4551b,
    .green = 0x138a55, .red = 0xd2383c, .cyan = 0x0b7f90,
};
static bool dark = true;

void ui_theme_set_dark(bool value) { dark = value; }
bool ui_theme_dark(void) { return dark; }
const ui_palette_t *ui_pal(void) { return dark ? &dark_palette : &light_palette; }

uint32_t ui_tint(uint32_t color, uint8_t amount) {
    lv_color32_t mixed = {.full = lv_color_to32(lv_color_mix(lv_color_hex(color), lv_color_hex(ui_pal()->surface), amount))};
    return ((uint32_t)mixed.ch.red << 16) | ((uint32_t)mixed.ch.green << 8) | mixed.ch.blue;
}

uint32_t ui_tone(const char *tone) {
    const ui_palette_t *p = ui_pal();
    if (!tone) return p->text2;
    if (!strcmp(tone, "done") || !strcmp(tone, "confirmed") || !strcmp(tone, "completed")) return p->green;
    if (!strcmp(tone, "waiting") || !strcmp(tone, "forecast")) return p->amber;
    if (!strcmp(tone, "late") || !strcmp(tone, "overdue")) return p->red;
    if (!strcmp(tone, "banked")) return p->violet;
    if (!strcmp(tone, "related")) return p->blue;
    return p->text2;
}

/* Tagged Radar posts get a card tinted with their tag tone; plain posts keep the base surface. */
uint32_t ui_post_bg(const char *tag, const char *tone, uint32_t base) {
    uint32_t color = ui_tone(tone);
    return tag && *tag && color != ui_pal()->text2 ? ui_tint(color, 40) : base;
}

uint32_t ui_sensor_accent(const char *type) {
    const ui_palette_t *p = ui_pal();
    if (!type || !*type) return p->blue;
    if (strstr(type, "温") || strstr(type, "Temp")) return p->amber;
    if (strstr(type, "功") || strstr(type, "Power")) return p->orange;
    if (strstr(type, "负载") || strstr(type, "Load")) return p->violet;
    if (strstr(type, "时钟") || strstr(type, "频率") || strstr(type, "Clock")) return p->cyan;
    if (strstr(type, "风扇") || strstr(type, "Fan")) return p->green;
    return p->blue;
}

uint32_t ui_health_color(const char *label) {
    const ui_palette_t *p = ui_pal();
    if (!label || !*label || strstr(label, "未启用")) return p->text3;
    if (strstr(label, "异常") || strstr(label, "失败") || strstr(label, "未连接")) return p->red;
    if (strstr(label, "监测中") || strstr(label, "更新中") || strstr(label, "已连接")) return p->green;
    return p->amber;
}

void ui_passive(lv_obj_t *object) {
    lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(object, LV_OBJ_FLAG_GESTURE_BUBBLE | LV_OBJ_FLAG_EVENT_BUBBLE);
}
void ui_passive_tree(lv_obj_t *object) {
    if (!lv_obj_has_flag(object, LV_OBJ_FLAG_CLICKABLE)) ui_passive(object);
    for (uint32_t i = 0; i < lv_obj_get_child_cnt(object); i++) ui_passive_tree(lv_obj_get_child(object, i));
}
void ui_set_text(lv_obj_t *label, const char *text) {
    if (label && strcmp(lv_label_get_text(label), text ? text : "")) lv_label_set_text(label, text ? text : "");
}
void ui_set_text_clean(lv_obj_t *label, const char *text) {
    char clean[512]; size_t out = 0;
    const unsigned char *s = (const unsigned char *)(text ? text : "");
    while (*s && out < sizeof(clean) - 4) {
        if (*s >= 0xf0) { int n = 1; while (n < 4 && s[n]) n++; s += n; continue; }
        if ((s[0] == 0xe2 && s[1] == 0x80 && s[2] == 0x8d) || (s[0] == 0xef && s[1] == 0xb8 && s[2] == 0x8f)) { s += 3; continue; }
        if (*s == ' ' && (out == 0 || clean[out - 1] == ' ')) { s++; continue; }
        clean[out++] = (char)*s++;
    }
    while (out && clean[out - 1] == ' ') out--;
    clean[out] = 0;
    ui_set_text(label, clean);
}
void ui_set_color(lv_obj_t *label, uint32_t color) {
    if (label && lv_obj_get_style_text_color(label, 0).full != lv_color_hex(color).full) lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
}
void ui_set_bg(lv_obj_t *object, uint32_t color) {
    if (object && lv_obj_get_style_bg_color(object, 0).full != lv_color_hex(color).full) lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
}
void ui_set_visible(lv_obj_t *object, bool visible) {
    if (!object) return;
    bool hidden = lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN);
    if (visible && hidden) lv_obj_clear_flag(object, LV_OBJ_FLAG_HIDDEN);
    else if (!visible && !hidden) lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
}
lv_coord_t ui_text_width(const lv_font_t *font, const char *text) {
    lv_point_t size;
    lv_txt_get_size(&size, text ? text : "", font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    return size.x;
}

lv_obj_t *ui_box(lv_obj_t *parent, int x, int y, int w, int h, uint32_t bg, int radius) {
    lv_obj_t *object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_set_pos(object, x, y); lv_obj_set_size(object, w, h);
    lv_obj_set_style_bg_color(object, lv_color_hex(bg), 0); lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(object, radius, 0);
    ui_passive(object);
    return object;
}
lv_obj_t *ui_card(lv_obj_t *parent, int x, int y, int w, int h) {
    return ui_box(parent, x, y, w, h, ui_pal()->surface, UI_RADIUS);
}
lv_obj_t *ui_label(lv_obj_t *parent, int x, int y, int w, int h, const lv_font_t *font, uint32_t color, lv_text_align_t align) {
    lv_obj_t *object = lv_label_create(parent);
    lv_obj_set_pos(object, x, y); lv_obj_set_size(object, w, h);
    lv_label_set_long_mode(object, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(object, font, 0); lv_obj_set_style_text_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(object, align, 0); lv_obj_set_style_pad_all(object, 0, 0);
    lv_label_set_text(object, "");
    ui_passive(object);
    return object;
}
lv_obj_t *ui_dot(lv_obj_t *parent, int x, int y, int size, uint32_t color) {
    return ui_box(parent, x, y, size, size, color, LV_RADIUS_CIRCLE);
}
lv_obj_t *ui_hairline(lv_obj_t *parent, int x, int y, int w) {
    return ui_box(parent, x, y, w, 1, ui_pal()->border, 0);
}
lv_obj_t *ui_chip(lv_obj_t *parent, int x, int y, int h, uint32_t color) {
    lv_obj_t *chip = ui_box(parent, x, y, LV_SIZE_CONTENT, h, ui_tint(color, 46), h / 2);
    lv_obj_set_style_pad_hor(chip, 12, 0);
    lv_obj_t *caption = lv_label_create(chip);
    lv_obj_set_style_text_font(caption, &ui_font_20m, 0); lv_obj_set_style_text_color(caption, lv_color_hex(color), 0);
    lv_obj_align(caption, LV_ALIGN_LEFT_MID, 0, 0); lv_label_set_text(caption, "");
    ui_passive(caption);
    return chip;
}
void ui_chip_set(lv_obj_t *chip, const char *text, uint32_t color) {
    lv_obj_t *caption = lv_obj_get_child(chip, 0);
    ui_set_text(caption, text); ui_set_color(caption, color); ui_set_bg(chip, ui_tint(color, 46));
    ui_set_visible(chip, text && *text);
}
lv_obj_t *ui_bar(lv_obj_t *parent, int x, int y, int w, int h, uint32_t color) {
    lv_obj_t *bar = lv_bar_create(parent);
    lv_obj_remove_style_all(bar);
    lv_obj_set_pos(bar, x, y); lv_obj_set_size(bar, w, h); lv_bar_set_range(bar, 0, 100);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_MAIN); lv_obj_set_style_bg_color(bar, lv_color_hex(ui_pal()->surface2), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_INDICATOR); lv_obj_set_style_bg_color(bar, lv_color_hex(color), LV_PART_INDICATOR);
    lv_obj_set_style_radius(bar, h / 2, LV_PART_MAIN); lv_obj_set_style_radius(bar, h / 2, LV_PART_INDICATOR);
    ui_passive(bar);
    return bar;
}
lv_obj_t *ui_ring(lv_obj_t *parent, int x, int y, int size, int width, int sweep, uint32_t color) {
    lv_obj_t *ring = lv_arc_create(parent);
    lv_obj_remove_style_all(ring);
    lv_obj_set_pos(ring, x, y); lv_obj_set_size(ring, size, size);
    lv_arc_set_rotation(ring, sweep >= 360 ? 270 : 90 + (360 - sweep) / 2); lv_arc_set_bg_angles(ring, 0, sweep >= 360 ? 360 : sweep); lv_arc_set_range(ring, 0, 1000); lv_arc_set_value(ring, 0);
    lv_obj_set_style_arc_width(ring, width, LV_PART_MAIN); lv_obj_set_style_arc_width(ring, width, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(ring, lv_color_hex(ui_pal()->surface2), LV_PART_MAIN); lv_obj_set_style_arc_opa(ring, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_arc_color(ring, lv_color_hex(color), LV_PART_INDICATOR); lv_obj_set_style_arc_opa(ring, LV_OPA_COVER, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(ring, true, LV_PART_MAIN); lv_obj_set_style_arc_rounded(ring, true, LV_PART_INDICATOR);
    ui_passive(ring);
    return ring;
}
void ui_ring_value(lv_obj_t *ring, double value) {
    int scaled = isfinite(value) && value > 0 ? (int)lround(fmin(100, value) * 10) : 0;
    if (lv_arc_get_value(ring) != scaled) lv_arc_set_value(ring, scaled);
    /* A rounded cap would still draw a dot at zero. */
    lv_opa_t opa = scaled ? LV_OPA_COVER : LV_OPA_TRANSP;
    if (lv_obj_get_style_arc_opa(ring, LV_PART_INDICATOR) != opa) lv_obj_set_style_arc_opa(ring, opa, LV_PART_INDICATOR);
}
lv_obj_t *ui_hit_area(lv_obj_t *parent, int x, int y, int w, int h, lv_event_cb_t callback, int code) {
    lv_obj_t *object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_set_pos(object, x, y); lv_obj_set_size(object, w, h);
    lv_obj_add_flag(object, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_set_style_radius(object, UI_RADIUS, 0);
    lv_obj_set_style_bg_color(object, lv_color_hex(ui_pal()->text), LV_STATE_PRESSED);
    lv_obj_set_style_bg_opa(object, 20, LV_STATE_PRESSED);
    lv_obj_add_event_cb(object, callback, LV_EVENT_CLICKED, (void *)(intptr_t)code);
    return object;
}

void ui_fit_font(lv_obj_t *label, const char *text, const lv_font_t *large, const lv_font_t *small) {
    const lv_font_t *font = ui_text_width(large, text) <= lv_obj_get_style_width(label, 0) ? large : small;
    if (lv_obj_get_style_text_font(label, 0) != font) lv_obj_set_style_text_font(label, font, 0);
    ui_set_text(label, text);
}

void ui_status_build(ui_status_t *status, lv_obj_t *parent, int right, int y) {
    status->right = right;
    status->label = ui_label(parent, right - 240, y, 240, 24, &ui_font_20r, ui_pal()->text2, LV_TEXT_ALIGN_RIGHT);
    status->dot = ui_dot(parent, right - 12, y + 8, 10, ui_pal()->text3);
}
void ui_status_set(ui_status_t *status, const char *text, uint32_t dot_color, uint32_t text_color) {
    ui_set_text(status->label, text); ui_set_color(status->label, text_color); ui_set_bg(status->dot, dot_color);
    int width = ui_text_width(&ui_font_20r, text);
    if (width > 240) width = 240;
    lv_obj_set_x(status->dot, status->right - width - 18);
}

static const char *json_text(cJSON *object, const char *key) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : "";
}
/* Keeps a label's baseline fixed while swapping between display sizes. */
static void place_on_baseline(lv_obj_t *label, const lv_font_t *font, int baseline) {
    int y = baseline - (font->line_height - font->base_line);
    if (lv_obj_get_style_text_font(label, 0) != font) lv_obj_set_style_text_font(label, font, 0);
    if (lv_obj_get_height(label) != font->line_height) lv_obj_set_height(label, font->line_height);
    if (lv_obj_get_y(label) != y) lv_obj_set_y(label, y);
}

/* Layout (top to bottom): type, name, hardware; then bottom-anchored value, bar, detail row and
   min/max, so values line up across cards of the same height. */
void ui_sensor_card_build(ui_sensor_card_t *s, lv_obj_t *parent, int x, int y, int w, int h) {
    const ui_palette_t *p = ui_pal();
    const int inner = w - 2 * UI_PAD;
    memset(s, 0, sizeof(*s));
    s->width = w; s->height = h;
    s->card = ui_card(parent, x, y, w, h);
    s->dot = ui_dot(s->card, UI_PAD, 22, 10, p->blue);
    s->kind = ui_label(s->card, UI_PAD + 18, 14, inner - 18, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_LEFT);
    s->name = ui_label(s->card, UI_PAD, 42, inner, 35, &ui_font_32b, p->text, LV_TEXT_ALIGN_LEFT);
    s->hardware = ui_label(s->card, UI_PAD, 80, inner, 24, &ui_font_20r, p->text3, LV_TEXT_ALIGN_LEFT);
    s->value = ui_label(s->card, UI_PAD, 0, inner, 72, &ui_font_64b, p->blue, LV_TEXT_ALIGN_LEFT);
    s->bar = ui_bar(s->card, UI_PAD, h - 76, inner, 8, p->blue);
    s->percent = ui_label(s->card, UI_PAD, h - 62, inner / 2, 24, &ui_font_20m, p->blue, LV_TEXT_ALIGN_LEFT);
    s->total = ui_label(s->card, w / 2, h - 62, w / 2 - UI_PAD, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_RIGHT);
    s->minimum = ui_label(s->card, UI_PAD, h - 36, inner / 2, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_LEFT);
    s->maximum = ui_label(s->card, w / 2, h - 36, w / 2 - UI_PAD, 24, &ui_font_20r, p->text2, LV_TEXT_ALIGN_RIGHT);
}

static double leading_number(const char *text) {
    char *end = NULL;
    double value = strtod(text ? text : "", &end);
    return end && end != text ? value : NAN;
}

void ui_sensor_card_update(ui_sensor_card_t *s, cJSON *item, bool show_minmax) {
    const ui_palette_t *p = ui_pal();
    const char *type = json_text(item, "type"), *value = json_text(item, "value");
    const char *pct_text = json_text(item, "percent"), *total = json_text(item, "total");
    const char *min_text = json_text(item, "min"), *max_text = json_text(item, "max");
    if (!*pct_text) pct_text = json_text(item, "side");
    uint32_t accent = ui_sensor_accent(type);
    ui_set_text(s->kind, *type ? type : "指标"); ui_set_text(s->name, json_text(item, "name")); ui_set_text(s->hardware, json_text(item, "hardware"));
    ui_set_bg(s->dot, accent); ui_set_color(s->value, accent); ui_set_color(s->percent, accent);
    lv_obj_set_style_bg_color(s->bar, lv_color_hex(accent), LV_PART_INDICATOR);

    const lv_font_t *font = ui_text_width(&ui_font_64b, value) <= s->width - 2 * UI_PAD ? &ui_font_64b : &ui_font_44b;
    /* Sit clear of the bar, but never above the hardware line on shorter cards. */
    int baseline = (int)fmax(s->height - 98, 108 + ui_font_64b.line_height - ui_font_64b.base_line);
    place_on_baseline(s->value, font, baseline);
    ui_set_text(s->value, *value ? value : "--");

    /* Capacity sensors show fill; others show where the reading sits between min and max. */
    bool capacity = *pct_text || *total;
    cJSON *pct = cJSON_GetObjectItemCaseSensitive(item, "pct");
    double fill = cJSON_IsNumber(pct) && isfinite(pct->valuedouble) ? pct->valuedouble : NAN;
    if (!capacity) {
        double current = leading_number(value), low = leading_number(min_text), high = leading_number(max_text);
        fill = isfinite(current) && isfinite(low) && isfinite(high) && high > low ? (current - low) * 100 / (high - low) : NAN;
    }
    int bar_value = isfinite(fill) ? (int)fmax(0, fmin(100, fill)) : 0;
    ui_set_visible(s->bar, isfinite(fill));
    if (lv_bar_get_value(s->bar) != bar_value) lv_bar_set_value(s->bar, bar_value, LV_ANIM_OFF);

    ui_set_text(s->percent, pct_text); ui_set_visible(s->percent, *pct_text);
    char total_text[48]; snprintf(total_text, sizeof(total_text), *total ? "共 %s" : "", total);
    ui_set_text(s->total, total_text); ui_set_visible(s->total, *total);

    char minimum[48], maximum[48];
    snprintf(minimum, sizeof(minimum), "最低 %s", *min_text ? min_text : "--");
    snprintf(maximum, sizeof(maximum), "最高 %s", *max_text ? max_text : "--");
    ui_set_text(s->minimum, minimum); ui_set_text(s->maximum, maximum);
    ui_set_visible(s->minimum, show_minmax); ui_set_visible(s->maximum, show_minmax);
    (void)p;
}
