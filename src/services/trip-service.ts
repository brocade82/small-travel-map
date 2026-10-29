import type { TripRecord } from "../types";
import { normalizeDate, toLocalIsoString } from "../core/dates";
import { generateUniqueId } from "../core/ids";
import { sanitizeFileName } from "../core/text";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

export interface CreateTripInput {
  title: string;
  start?: string;
  end?: string;
  cities?: string[];
  tags?: string[];
  summary?: string;
}

export class TripService {
  constructor(
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  async create(input: CreateTripInput): Promise<TripRecord> {
    const title = input.title.trim();
    if (!title) throw new Error("行程需要一个标题");
    const id = generateUniqueId((candidate) => this.index.hasId(candidate));
    const now = toLocalIsoString();
    const start = normalizeDate(input.start) ?? undefined;
    const end = normalizeDate(input.end) ?? start;

    const frontmatter: Record<string, unknown> = {
      kind: "trip",
      schema_version: 1,
      id,
      title,
      start,
      end,
      cities: (input.cities ?? []).map((city) => city.trim()).filter(Boolean),
      tags: Array.from(new Set(["旅游/行程", ...(input.tags ?? [])])),
      created: now,
      updated: now,
    };
    const file = await this.repo.createNote(
      this.repo.tripFolder(),
      sanitizeFileName(title, "未命名行程"),
      frontmatter,
      `# ${title}\n\n${input.summary?.trim() ?? ""}\n\n`
    );
    await this.index.refreshFile(file);
    const trip = this.index.getTrip(id);
    if (!trip) throw new Error("行程写入后未能进入索引，请运行「重建旅游索引」");
    return trip;
  }

  list(): TripRecord[] {
    return [...this.index.getTrips()].sort((a, b) =>
      (b.start ?? "").localeCompare(a.start ?? "")
    );
  }
}
