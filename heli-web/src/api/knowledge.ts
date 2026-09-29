import { apiRequest } from "./client";

export interface Library { slug: string; id: string; name: string }
export interface Section { section_id: string; parent_id: string | null; title: string; position: number }
export interface Placement { section_id: string; source_id: string; position: number }
export interface Document { source_id: string; title: string; path: string; online?: number; last_seen_sha256: string; active_version_id: string | null; indexed_sha256: string | null }
export interface Tree { kb_id: string; name: string; sections: Section[]; placements: Placement[]; documents: Document[] }
export interface DocumentPage { total: number; offset: number; documents: Document[]; next_offset: number | null }
export interface OutlineSection { index: number; title: string; level: number; char_start: number; char_end: number }
export interface Outline { content_kind: "source" | "parsed"; source_sha256: string; source_id: string; title: string; url: string | null; sha256: string; total_chars: number; sections: OutlineSection[] }
export interface SectionContent { source_id: string; title: string; url: string | null; sha256: string; section: OutlineSection; text: string }

/** 全文检索命中（后端 BM25 / FTS5）：给出原文字符区间与所属章节序号 */
export interface SearchHit {
  sha256: string;
  source_id: string;
  path: string;
  title: string;
  score: number;
  char_start: number;
  char_end: number;
  section_index: number;
  snippets: { text: string; hit_start: number; hit_end: number }[];
}
export interface SearchResult {
  engine: string;
  query: string;
  section: string | null;
  offset: number;
  total: number;
  candidates: number;
  /** bm25（≥3 字符）或 substring（更短的词，trigram 匹配不到时退回子串扫描） */
  ranked_by: string;
  hits: SearchHit[];
  next_offset: number | null;
}
export interface SearchStatus {
  engine: string;
  built: boolean;
  documents: number;
  chars?: number;
  built_at: string | null;
  /** 索引文件位置，处理记录页要把它显示给使用者 */
  path?: string;
}

export interface ContentStatus { sources: number; pdf_sources: number; parsed_documents: number; imported_results: number; unmatched_results: number; warnings: { file: string; error: string }[] }

export const DOCUMENTS_PAGE_SIZE = 50;

const base = (slug: string) => `/libraries/${encodeURIComponent(slug)}`;

export const knowledgeApi = {
  libraries: () => apiRequest<{ libraries: Library[] }>("/libraries"),
  tree: (slug: string) => apiRequest<Tree>(`${base(slug)}/tree`),
  documents: (slug: string, section: string | null, text: string, offset: number, limit = DOCUMENTS_PAGE_SIZE) =>
    apiRequest<DocumentPage>(`${base(slug)}/documents`, {
      query: { section: section ?? "", text, offset, limit },
    }),
  outline: (slug: string, id: string) =>
    apiRequest<Outline>(`${base(slug)}/documents/${encodeURIComponent(id)}/outline`),
  section: (slug: string, id: string, index: number, sha: string) =>
    apiRequest<SectionContent>(`${base(slug)}/documents/${encodeURIComponent(id)}/sections/${index}`, {
      query: { sha256: sha },
    }),
  search: (slug: string, text: string, section: string | null, limit = 20, offset = 0) =>
    apiRequest<SearchResult>(`${base(slug)}/search`, {
      query: { q: text, section: section ?? "", limit, offset },
    }),
  contentStatus: (slug: string) => apiRequest<ContentStatus>(`${base(slug)}/content-status`),
  refresh: (slug: string) => apiRequest<{ content: ContentStatus; index: { indexed: number; unparsed: string[] } }>(`${base(slug)}/refresh`, { body: {} }),
  searchStatus: (slug: string) => apiRequest<SearchStatus>(`${base(slug)}/search-status`),
  rename: (slug: string, name: string) => apiRequest<{ name: string }>(`${base(slug)}/name`, { body: { name } }),
  editSection: (slug: string, title: string, section_id?: string, parent_id?: string) =>
    apiRequest<Section>(`${base(slug)}/sections`, { body: { title, section_id, parent_id } }),
  place: (slug: string, source_id: string, section_id: string, remove: boolean) =>
    apiRequest<unknown>(`${base(slug)}/placements`, { body: { source_id, section_id, remove } }),
};
