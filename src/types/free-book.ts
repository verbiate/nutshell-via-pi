export interface FreeBook {
  id: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  epubUrl: string;
  source: string;
  sourceUrl: string | null;
  md5: string;
  // ponytail: set by /my-library page from getPersonalLibrary() md5 set.
  added?: boolean;
}
