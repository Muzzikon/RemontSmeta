export type ThemePreference='dark'|'light'|'system';
export const THEME_KEY='remont_smeta_v1_theme';
export function themePreference(value:unknown):ThemePreference{return value==='light'||value==='system'?value:'dark'}
let currentTheme:ThemePreference|undefined;
export function readTheme():ThemePreference{if(currentTheme)return currentTheme;try{currentTheme=themePreference(localStorage.getItem(THEME_KEY))}catch{currentTheme='dark'}return currentTheme}
export function applyTheme(value:unknown):boolean{
 const preference=themePreference(value);currentTheme=preference;let saved=true;
 try{localStorage.setItem(THEME_KEY,preference)}catch{saved=false}
 window.dispatchEvent(new CustomEvent('remontsmeta-theme',{detail:preference}));return saved;
}
export function themeControl():string{const current=readTheme();return `<label class="theme-control"><span>Тема</span><select id="theme-choice" aria-label="Тема оформления">${(['dark','light','system'] as const).map(p=>`<option value="${p}" ${current===p?'selected':''}>${p==='dark'?'Тёмная':p==='light'?'Светлая':'Как в системе'}</option>`).join('')}</select></label>`}
