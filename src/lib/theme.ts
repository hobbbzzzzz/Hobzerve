export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "hobzerve-theme";

// Runs in <head> before the first paint so a saved dark choice never flashes light.
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
