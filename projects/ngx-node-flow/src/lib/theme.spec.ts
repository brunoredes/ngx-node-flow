import { DEFAULT_NODE_FLOW_THEME } from './config';
import { privateProp, publicProp, resolveTheme, themeStyles } from './theme';

describe('theme', () => {
  it('maps keys to public and private CSS properties', () => {
    expect(publicProp('nodeSelectedColor')).toBe('--nf-node-selected-color');
    expect(privateProp('nodeSelectedColor')).toBe('--__nf-node-selected-color');
  });

  it('private props read the public prop first, with the theme value as fallback', () => {
    const styles = themeStyles({ ...DEFAULT_NODE_FLOW_THEME, accent: 'var(--ds-primary)' });
    expect(styles['--__nf-accent']).toBe('var(--nf-accent, var(--ds-primary))');
    expect(styles['--__nf-background']).toBe(`var(--nf-background, ${DEFAULT_NODE_FLOW_THEME.background})`);
    expect(Object.keys(styles).length).toBe(Object.keys(DEFAULT_NODE_FLOW_THEME).length);
  });

  it('resolveTheme reads non-color tokens from the private props', () => {
    const el = document.createElement('span');
    el.style.setProperty('--__nf-font-family', ' Inter, sans-serif');
    document.body.append(el);
    expect(resolveTheme(el, ['fontFamily']).fontFamily).toBe('Inter, sans-serif');
    el.remove();
  });
});
