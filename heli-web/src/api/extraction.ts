import { apiRequest } from "./client";
import type { ExtractScope } from "../types";
export interface PlanSchema {
  name: string;
  record_scope: ExtractScope;
  instructions: string;
  fields: { name: string; type: "string" | "number" | "boolean" | "string[]"; hint: string; required: boolean; missing: string }[];
}
export interface ExtractionPlan {
  id: string; version: string; schema: PlanSchema; saved_at: string;
  history: { version: string; schema: PlanSchema; saved_at: string }[];
}
const path = (slug: string) => `/libraries/${encodeURIComponent(slug)}/extraction-plans`;
export const extractionApi = {
  list: (slug: string) => apiRequest<{ plans: ExtractionPlan[] }>(path(slug)),
  save: (slug: string, schema: PlanSchema, current?: ExtractionPlan) =>
    apiRequest<ExtractionPlan>(path(slug), { body: { schema, id: current?.id, base_version: current?.version } }),
};

export interface ImportedSource { source_id: string; path: string; title: string; stale?: boolean }
export interface ImportedSummary { id: string; doc_id: string; version: string; generated_at: string; sources: ImportedSource[]; association: string; facet_count: number; process?: { status?: string } }
export interface ImportedEvidence { quote: string; locator?: { basis?: string; page?: number; chunk_id?: string }; version?: string }
export interface ImportedFacet { key: string; state: string; items?: { id: string; name: string; desc?: string; status?: string; evidence?: ImportedEvidence[] }[] }
export interface ImportedDetail { id: string; sources: ImportedSource[]; association: string; result: { doc_id: string; version: string; schema_version?: number; prompt_version?: number; model?: string; generated_at?: string; facets: ImportedFacet[]; relations?: { from: { dimension: string; item_id: string }; to: { dimension: string; item_id: string }; basis: string }[] } }
export interface EvidenceCheck { verified: boolean; reason?: string; source_id: string; sha256: string; quote: string; char_start?: number; char_end?: number; section_index?: number; text?: string }
export interface ImportedPage { results: ImportedSummary[]; total: number; next_offset: number | null; warnings: { file: string; error: string }[] }
const resultsPath = (slug: string) => `/libraries/${encodeURIComponent(slug)}/extraction-results`;
export const importedResultsApi = {
  list: (slug: string, q: string, offset: number) => apiRequest<ImportedPage>(resultsPath(slug), { query: { q, offset } }),
  detail: (slug: string, id: string) => apiRequest<ImportedDetail>(`${resultsPath(slug)}/${encodeURIComponent(id)}`),
  evidence: (slug: string, id: string, source_id: string, facet: number, item: number, evidence: number) =>
    apiRequest<EvidenceCheck>(`${resultsPath(slug)}/${encodeURIComponent(id)}/evidence`, { query: { source_id, facet, item, evidence } }),
};
