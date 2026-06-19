export interface Book {
  id: string;
  md5: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  epubPath: string;
  txtPath: string;
  tocJson: string | null;
  fileSize: number;
  uploadedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookWithAccess extends Book {
  accessGrantedAt: Date;
}

export interface LibraryBook {
  id: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  progress: number | null;
  hasProgress: boolean;
}

export type UserRole = "regular" | "pro" | "admin";
