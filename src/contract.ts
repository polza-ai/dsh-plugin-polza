// Каталог Пользы: разбор GET /v1/models, цены и стартовый белый список.
// Перенесено из bb-plugin-polza (src/polza/contract.ts).
import { z } from "zod";

export const POLZA_PROVIDER_ID = "polza";
export const POLZA_DEFAULT_BASE_URL = "https://polza.ai/api";
export const POLZA_DASHBOARD_URL = "https://polza.ai/dashboard";

/** Стартовый список моделей — пресет «Популярные» (src/presets.ts). */
export { STARTER_MODELS as POLZA_STARTER_MODELS } from './presets.ts';

export const polzaModelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/iu, "Expected a <vendor>/<model> slug");

/** Per-million-token prices in rubles, as the catalog reports them. */
export interface PolzaModelPricing {
  promptPerMillion: number;
  completionPerMillion: number;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
}

export interface PolzaCatalogModel {
  id: string;
  name: string;
  shortDescription: string | null;
  vendor: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  supportsReasoning: boolean;
  /** Effort ids the catalog lists for the model, in its own order. */
  reasoningEfforts: string[] | null;
  /** Модель всегда рассуждает: выключить reasoning нельзя. */
  reasoningMandatory: boolean;
  pricing: PolzaModelPricing | null;
  inputModalities: string[];
  supportsTools: boolean;
  fz152Compliant: boolean;
  /** Слаг иконки провайдера на icons.polza.ai. */
  iconSlug: string | null;
  /** Данные обрабатываются в РФ (модель или её основной провайдер). */
  storesInRussia: boolean;
}

const decimalStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const pricingSchema = z
  .object({
    prompt_per_million: decimalStringSchema.nullish(),
    completion_per_million: decimalStringSchema.nullish(),
    input_cache_read_per_million: decimalStringSchema.nullish(),
    input_cache_write_per_million: decimalStringSchema.nullish(),
    currency: z.string().nullish(),
  })
  .passthrough();

const catalogEntrySchema = z
  .object({
    id: polzaModelSlugSchema,
    name: z.string().catch(""),
    type: z.string().catch("chat"),
    short_description: z.string().nullish(),
    context_length: z.number().nullish(),
    max_completion_tokens: z.number().nullish(),
    is_fz152_compliant: z.boolean().catch(false),
    stores_data_in_russia: z.boolean().catch(false),
    icon_provider_slug: z.string().nullish(),
    reasoning: z
      .object({
        mandatory: z.boolean().nullish(),
        supported_efforts: z.array(z.string()).nullish(),
        default_effort: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    architecture: z
      .object({ input_modalities: z.array(z.string()).nullish() })
      .passthrough()
      .nullish(),
    top_provider: z
      .object({
        pricing: pricingSchema.nullish(),
        supported_parameters: z.array(z.string()).nullish(),
        context_length: z.number().nullish(),
        max_completion_tokens: z.number().nullish(),
        is_fz152_compliant: z.boolean().nullish(),
        stores_data_in_russia: z.boolean().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export const polzaCatalogResponseSchema = z
  .object({ data: z.array(z.unknown()) })
  .passthrough();

function toPricing(
  raw: z.infer<typeof pricingSchema> | null | undefined,
): PolzaModelPricing | null {
  if (!raw) return null;
  const prompt = raw.prompt_per_million ?? null;
  const completion = raw.completion_per_million ?? null;
  if (prompt === null || completion === null) return null;
  return {
    promptPerMillion: prompt,
    completionPerMillion: completion,
    cacheReadPerMillion: raw.input_cache_read_per_million ?? null,
    cacheWritePerMillion: raw.input_cache_write_per_million ?? null,
  };
}

/** Parses one catalog entry (`GET /v1/models/{slug}` or an item of the list); null when malformed or not a chat model. */
export function parsePolzaCatalogEntry(raw: unknown): PolzaCatalogModel | null {
  const parsed = catalogEntrySchema.safeParse(raw);
  if (!parsed.success || parsed.data.type !== "chat") return null;
  const model = parsed.data;
  const efforts = model.reasoning?.supported_efforts?.filter(
    (effort) => effort.trim().length > 0,
  );
  const supportedParameters = model.top_provider?.supported_parameters ?? [];
  return {
    id: model.id,
    name: model.name || model.id,
    shortDescription: model.short_description?.trim() || null,
    vendor: model.id.split("/")[0] ?? "",
    contextLength: model.context_length ?? model.top_provider?.context_length ?? null,
    maxCompletionTokens:
      model.max_completion_tokens ?? model.top_provider?.max_completion_tokens ?? null,
    supportsReasoning:
      (efforts !== undefined && efforts !== null && efforts.length > 0) ||
      supportedParameters.includes("reasoning") ||
      supportedParameters.includes("reasoning_effort"),
    reasoningEfforts: efforts && efforts.length > 0 ? efforts : null,
    reasoningMandatory: model.reasoning?.mandatory === true,
    pricing: toPricing(model.top_provider?.pricing),
    inputModalities: model.architecture?.input_modalities ?? ["text"],
    supportsTools: supportedParameters.includes("tools"),
    fz152Compliant: model.is_fz152_compliant || model.top_provider?.is_fz152_compliant === true,
    storesInRussia: model.stores_data_in_russia || model.top_provider?.stores_data_in_russia === true,
    iconSlug: model.icon_provider_slug ?? null,
  };
}

/** Parses one `GET /v1/models` response; malformed entries are dropped. */
export function parsePolzaCatalog(raw: unknown): PolzaCatalogModel[] {
  const envelope = polzaCatalogResponseSchema.safeParse(raw);
  if (!envelope.success) return [];
  const models: PolzaCatalogModel[] = [];
  for (const entry of envelope.data.data) {
    const model = parsePolzaCatalogEntry(entry);
    if (model !== null) models.push(model);
  }
  return models;
}

export interface PolzaTokenCounts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Rubles for one request's token counts; null when the model has no price. */
export function estimatePolzaCostRub(
  pricing: PolzaModelPricing | null,
  tokens: PolzaTokenCounts,
): number | null {
  if (pricing === null) return null;
  const perToken = (perMillion: number | null, fallback: number) =>
    (perMillion ?? fallback) / 1_000_000;
  return (
    tokens.input * perToken(pricing.promptPerMillion, 0) +
    tokens.cacheRead * perToken(pricing.cacheReadPerMillion, pricing.promptPerMillion) +
    tokens.cacheWrite * perToken(pricing.cacheWritePerMillion, pricing.promptPerMillion) +
    tokens.output * perToken(pricing.completionPerMillion, 0)
  );
}

/** "190 ₽ / 954 ₽ за Mtok" style price label; null without a price. */
export function formatPolzaPriceLabel(pricing: PolzaModelPricing | null): string | null {
  if (pricing === null) return null;
  return `${formatRub(pricing.promptPerMillion)} / ${formatRub(pricing.completionPerMillion)} за Mtok`;
}

export function formatRub(amount: number): string {
  const abs = Math.abs(amount);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const text = amount.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${text} ₽`;
}
