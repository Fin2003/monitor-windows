#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "lvgl.h"
#include "cJSON.h"

/* One type family (HarmonyOS Sans SC), one scale. See scripts/generate-ui-fonts.cjs. */
LV_FONT_DECLARE(ui_font_14r);
LV_FONT_DECLARE(ui_font_16r);
LV_FONT_DECLARE(ui_font_16m);
LV_FONT_DECLARE(ui_font_20r);
LV_FONT_DECLARE(ui_font_20m);
LV_FONT_DECLARE(ui_font_26b);
LV_FONT_DECLARE(ui_font_32b);
LV_FONT_DECLARE(ui_font_44b);
LV_FONT_DECLARE(ui_font_64b);

typedef struct {
    uint32_t bg, surface, surface2, border, text, text2, text3;
    uint32_t blue, violet, amber, orange, green, red, cyan;
} ui_palette_t;

/* Layout grid for the 1024 x 600 panel. */
enum { UI_MARGIN = 16, UI_GAP = 12, UI_PAD = 20, UI_RADIUS = 16, UI_RADIUS_S = 10 };

void ui_theme_set_dark(bool dark);
bool ui_theme_dark(void);
const ui_palette_t *ui_pal(void);
uint32_t ui_tint(uint32_t color, uint8_t amount);
uint32_t ui_tone(const char *tone);
uint32_t ui_post_bg(const char *tag, const char *tone, uint32_t base);
uint32_t ui_sensor_accent(const char *type);
uint32_t ui_health_color(const char *label);

void ui_passive(lv_obj_t *object);
void ui_passive_tree(lv_obj_t *object);
void ui_set_text(lv_obj_t *label, const char *text);
/* Drops emoji and joiners (no glyphs on the panel) and collapses the gaps they leave. */
void ui_set_text_clean(lv_obj_t *label, const char *text);
void ui_set_color(lv_obj_t *label, uint32_t color);
void ui_set_bg(lv_obj_t *object, uint32_t color);
void ui_set_visible(lv_obj_t *object, bool visible);
lv_coord_t ui_text_width(const lv_font_t *font, const char *text);

lv_obj_t *ui_box(lv_obj_t *parent, int x, int y, int w, int h, uint32_t bg, int radius);
lv_obj_t *ui_card(lv_obj_t *parent, int x, int y, int w, int h);
lv_obj_t *ui_label(lv_obj_t *parent, int x, int y, int w, int h, const lv_font_t *font, uint32_t color, lv_text_align_t align);
lv_obj_t *ui_dot(lv_obj_t *parent, int x, int y, int size, uint32_t color);
lv_obj_t *ui_hairline(lv_obj_t *parent, int x, int y, int w);
lv_obj_t *ui_chip(lv_obj_t *parent, int x, int y, int h, uint32_t color);
void ui_chip_set(lv_obj_t *chip, const char *text, uint32_t color);
lv_obj_t *ui_bar(lv_obj_t *parent, int x, int y, int w, int h, uint32_t color);
lv_obj_t *ui_ring(lv_obj_t *parent, int x, int y, int size, int width, int sweep, uint32_t color);
void ui_ring_value(lv_obj_t *ring, double value);
lv_obj_t *ui_hit_area(lv_obj_t *parent, int x, int y, int w, int h, lv_event_cb_t callback, int code);
/* Uses the large font when the text fits the label width, otherwise the small one. */
void ui_fit_font(lv_obj_t *label, const char *text, const lv_font_t *large, const lv_font_t *small);

/* Colored dot plus caption, right-aligned to a fixed edge. */
typedef struct { lv_obj_t *dot, *label; int right; } ui_status_t;
void ui_status_build(ui_status_t *status, lv_obj_t *parent, int right, int y);
void ui_status_set(ui_status_t *status, const char *text, uint32_t dot_color, uint32_t text_color);

/* Sensor card shared by the overview dashboard and the System page. */
typedef struct {
    lv_obj_t *card, *dot, *kind, *name, *hardware, *value, *percent, *total, *bar, *minimum, *maximum;
    int width, height;
    char type[24];
} ui_sensor_card_t;
void ui_sensor_card_build(ui_sensor_card_t *card, lv_obj_t *parent, int x, int y, int w, int h);
void ui_sensor_card_update(ui_sensor_card_t *card, cJSON *item, bool show_minmax);
