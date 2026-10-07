#pragma once
#include <stdlib.h>
#include <string.h>
typedef struct {size_t size;unsigned capacity,count,read,write;unsigned char *data;} *QueueHandle_t;
static inline QueueHandle_t xQueueCreate(int count,int size) {
    QueueHandle_t q=calloc(1,sizeof(*q));q->size=size;q->capacity=count;q->data=calloc(count,size);return q;
}
static inline int xQueueSend(QueueHandle_t q,const void *value,int timeout) {
    (void)timeout;if(q->count>=q->capacity)return 0;memcpy(q->data+q->write*q->size,value,q->size);q->write=(q->write+1)%q->capacity;q->count++;return 1;
}
static inline int xQueueOverwrite(QueueHandle_t q,const void *value) {
    q->read=q->write=q->count=0;return xQueueSend(q,value,0);
}
static inline int xQueueReceive(QueueHandle_t q,void *value,int timeout) {
    (void)timeout;if(!q->count)return 0;memcpy(value,q->data+q->read*q->size,q->size);q->read=(q->read+1)%q->capacity;q->count--;return 1;
}
