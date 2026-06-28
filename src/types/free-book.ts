export interface FreeBook {
  id: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  epubUrl: string;
  source: string;
  sourceUrl: string | null;
}
