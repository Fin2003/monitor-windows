#include "monitor_settings.h"
#include <stdlib.h>
static monitor_settings_t stored;
static bool initialized;
void monitor_settings_defaults(monitor_settings_t *s) {*s=(monitor_settings_t){.schema=1,.mask=15,.order={0,1,2,3},.dark=getenv("MONITOR_SIM_LIGHT")?0:1,.show_minmax=1};}
bool monitor_settings_load(monitor_settings_t *s) {if(initialized)*s=stored;else monitor_settings_defaults(s);return true;}
bool monitor_settings_save(const monitor_settings_t *s) {stored=*s;initialized=true;return true;}
