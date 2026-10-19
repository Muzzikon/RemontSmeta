const paths: Record<string,string> = {
folder:'<path d="M3 7V4h6l2 3h10v14H3Z"/>',
download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
print:'<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6ZM17 11h1"/>',
install:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 6v10m-4-4 4 4 4-4"/>',

receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 7h6M9 11h6M9 15h3"/>',
chart:'<path d="M4 20h17M7 16V9m5 7V4m5 12v-5"/>',
camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',

home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-9h6v9"/>',
grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
plus:'<path d="M12 5v14M5 12h14"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
edit:'<path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15Z"/>',
trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
leaf:'<path d="M20 3C8 2 3 7 5 14c2 7 14 6 15-11ZM5 20 16 9"/>',
lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
room:'<path d="M4 21V3h16v18M9 21V7h7v14M3 21h18M12 14h.01"/>',
materials:'<path d="m12 3 9 5-9 5-9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
work:'<path d="m14 5 5 5M3 21l4-1L19 8l-4-4L3 16ZM12 7l5 5"/>',
wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-5 5h5M7 5V3h11"/>',
};
export function icon(name:string):string { return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.room}</svg>` }
