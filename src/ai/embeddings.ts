export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  async embed(_text: string): Promise<number[]> {
    return [];
  }
}
