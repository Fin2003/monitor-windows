<script>
  let { name, size = 20, color = 'currentColor' } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'display'}
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  {:else if name === 'plugin'}
    <path d="M12 2L12 8L18 8L18 2" />
    <path d="M6 2L6 8L12 8" />
    <path d="M6 8L6 14L12 14L12 8" />
    <path d="M12 14L12 20L18 20L18 14" />
    <path d="M18 8L18 14L24 14" stroke="none" fill="none" />
    <rect x="4" y="1" width="4" height="7" rx="1" />
    <rect x="10" y="1" width="4" height="7" rx="1" />
    <rect x="4" y="7" width="4" height="7" rx="1" />
    <rect x="10" y="7" width="4" height="7" rx="1" />
    <rect x="10" y="13" width="4" height="7" rx="1" />
    <rect x="16" y="13" width="4" height="7" rx="1" />
  {:else if name === 'carousel'}
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="9 3 9 21" />
    <polyline points="15 3 15 21" />
    <circle cx="12" cy="8" r="1.5" fill={color} stroke="none" />
    <circle cx="12" cy="16" r="1.5" fill={color} stroke="none" />
  {:else if name === 'minus'}
    <line x1="5" y1="12" x2="19" y2="12" />
  {:else if name === 'close'}
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  {:else if name === 'chevron-left'}
    <polyline points="15 6 9 12 15 18" />
  {:else if name === 'chevron-right'}
    <polyline points="9 6 15 12 9 18" />
  {:else if name === 'chevron-up'}
    <polyline points="6 15 12 9 18 15" />
  {:else if name === 'chevron-down'}
    <polyline points="6 9 12 15 18 9" />
  {:else if name === 'toggle-left'}
    <rect x="1" y="6" width="22" height="12" rx="6" />
    <circle cx="7" cy="12" r="3" fill={color} stroke="none" />
  {:else if name === 'toggle-right'}
    <rect x="1" y="6" width="22" height="12" rx="6" />
    <circle cx="17" cy="12" r="3" fill={color} stroke="none" />
  {:else if name === 'play'}
    <polygon points="6 3 20 12 6 21" fill={color} stroke="none" />
  {:else if name === 'pause'}
    <rect x="6" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
  {:else if name === 'stop'}
    <rect x="4" y="4" width="16" height="16" rx="2" fill={color} stroke="none" />
  {:else if name === 'refresh'}
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  {:else if name === 'trash'}
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  {:else if name === 'eye'}
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" fill={color} stroke="none" />
  {:else if name === 'menu'}
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  {:else if name === 'sidebar'}
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  {:else if name === 'monitor'}
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  {:else if name === 'system-monitor'}
    <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />
    <rect x="2" y="3" width="20" height="18" rx="3" />
  {:else if name === 'power'}
    <path d="M12 2v6" />
    <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
  {:else if name === 'check'}
    <polyline points="4 12 10 18 20 6" />
  {:else if name === 'plus'}
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  {:else if name === 'coding'}
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  {:else if name === 'dot'}
    <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
  {:else if name === 'lock'}
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  {:else if name === 'unlock'}
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  {:else if name === 'moon'}
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  {:else if name === 'save'}
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  {:else if name === 'bookmark'}
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  {:else if name === 'folder'}
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  {:else if name === 'x'}
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  {:else if name === 'maximize'}
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  {:else if name === 'settings'}
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="var(--bg, #0A0A0B)" />
    <circle cx="15" cy="12" r="2" fill="var(--bg, #0A0A0B)" />
    <circle cx="9" cy="18" r="2" fill="var(--bg, #0A0A0B)" />
  {:else if name === 'edit'}
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  {/if}
</svg>
