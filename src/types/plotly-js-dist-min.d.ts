declare module 'plotly.js-dist-min' {
  type Data = Record<string, unknown>;
  type Layout = Record<string, unknown>;
  type Config = Record<string, unknown>;

  interface PlotlyStatic {
    newPlot(root: HTMLElement, data: Data[], layout?: Partial<Layout>, config?: Partial<Config>): Promise<HTMLElement>;
    react(root: HTMLElement, data: Data[], layout?: Partial<Layout>, config?: Partial<Config>): Promise<HTMLElement>;
    relayout(root: HTMLElement, layout: Partial<Layout>): Promise<HTMLElement>;
    purge(root: HTMLElement): void;
  }

  const Plotly: PlotlyStatic;
  export default Plotly;
}
