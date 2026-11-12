import { Component, computed, input } from '@angular/core';
import { ResultValue, SHAPES, ZOOM_MAX } from './cells';

/** Draws what the result cell receives: the shape, in the color, scaled by the zoom level. */
@Component({
  selector: 'app-result-preview',
  template: `
    <h2>Resultado</h2>
    @if (value(); as v) {
      <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="description()">
        @if (v.color && v.shape && v.zoom) {
          @switch (v.shape) {
            @case ('circle') {
              <circle cx="50" cy="50" [attr.r]="half()" [attr.fill]="v.color" />
            }
            @case ('square') {
              <rect [attr.x]="50 - half()" [attr.y]="50 - half()" [attr.width]="2 * half()" [attr.height]="2 * half()" [attr.fill]="v.color" />
            }
            @case ('triangle') {
              <polygon [attr.points]="triangle()" [attr.fill]="v.color" />
            }
          }
        }
      </svg>
      <dl>
        <dt>Cor</dt>
        <dd>{{ v.color ?? 'não conectada' }}</dd>
        <dt>Forma</dt>
        <dd>{{ shapeLabel() ?? 'não conectada' }}</dd>
        <dt>Zoom</dt>
        <dd>{{ v.zoom !== undefined ? v.zoom + '%' : 'não conectado' }}</dd>
      </dl>
    } @else {
      <p>Não há célula de resultado no fluxo.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
    h2 { margin: 0; font-size: 16px; }
    svg { width: 100%; aspect-ratio: 1; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 6px; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 14px; }
    dt { font-weight: 600; }
    dd { margin: 0; font-family: monospace; }
    p { margin: 0; font-size: 14px; }
  `,
})
export class ResultPreview {
  readonly value = input.required<ResultValue | null>();

  /** Half the shape's size: zoom 100% fills 90% of the box. */
  protected readonly half = computed(() => (45 * (this.value()?.zoom ?? 0)) / ZOOM_MAX);
  protected readonly triangle = computed(() => {
    const h = this.half();
    return `50,${50 - h} ${50 + h},${50 + h} ${50 - h},${50 + h}`;
  });
  protected readonly shapeLabel = computed(() => SHAPES.find((s) => s.value === this.value()?.shape)?.label);
  protected readonly description = computed(() => {
    const v = this.value();
    return v?.color && v.shape && v.zoom ? `${this.shapeLabel()} ${v.color} em ${v.zoom}%` : 'Resultado incompleto: faltam entradas';
  });
}
