import { NodeFlowTheme, ResolvedTheme } from './types';

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** Public (overridable) CSS property for a token. */
export const publicProp = (k: keyof NodeFlowTheme) => `--nf-${kebab(k)}`;
/** Private CSS property the lib reads internally; always has a fallback. */
export const privateProp = (k: keyof NodeFlowTheme) => `--__nf-${kebab(k)}`;

/** Host styles: `--__nf-x: var(--nf-x, <theme value>)`, so app CSS beats the provider, which beats defaults. */
export function themeStyles(theme: NodeFlowTheme): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(theme) as (keyof NodeFlowTheme)[]).map((k) => [privateProp(k), `var(${publicProp(k)}, ${theme[k]})`]),
  );
}

const NON_COLOR = new Set<keyof NodeFlowTheme>(['fontFamily', 'radius']);

/** Resolves every token to a concrete value via a probe element inside the host (colors come back as rgb()/rgba()). */
export function resolveTheme(probe: HTMLElement, keys: (keyof NodeFlowTheme)[]): ResolvedTheme {
  const out = {} as ResolvedTheme;
  const style = getComputedStyle(probe);
  for (const k of keys) {
    if (NON_COLOR.has(k)) {
      out[k] = style.getPropertyValue(privateProp(k)).trim();
    } else {
      probe.style.color = `var(${privateProp(k)})`;
      out[k] = getComputedStyle(probe).color;
    }
  }
  probe.style.color = '';
  return out;
}

/** Calls `onChange` whenever the page's theme may have changed (color scheme, theme classes/attributes). */
export function watchTheme(host: HTMLElement, onChange: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  const attributeFilter = ['class', 'style', 'data-theme', 'data-mode'];
  for (const el of [document.documentElement, document.body, host]) observer.observe(el, { attributes: true, attributeFilter });
  return () => {
    media.removeEventListener('change', onChange);
    observer.disconnect();
  };
}
