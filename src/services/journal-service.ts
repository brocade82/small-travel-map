import { TFile } from "obsidian";
import type { LogRecord, PlaceRecord, TripRecord } from "../types";
import { normalizeDate, todayIso, toLocalIsoString } from "../core/dates";
import { generateUniqueId } from "../core/ids";
import { sanitizeFileName } from "../core/text";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

export interface CreateJournalInput {
  title?: string;
  visitedStart?: string;
  visitedEnd?: string;
  tripId?: string;
  tags?: string[];
  pinned?: boolean;
  cover?: string;
  body?: string;
}

export class JournalService {
  constructor(
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  async create(placeId: string, input: CreateJournalInput = {}): Promise<LogRecord> {
    const place = this.index.getPlace(placeId);
    if (!place) throw new Error(`地点不存在：${placeId}`);

    const date = normalizeDate(input.visitedStart) ?? todayIso();
    const title = sanitizeFileName(input.title?.trim() || place.name, "旅行日志");
    const trip = input.tripId ? this.index.getTrip(input.tripId) : undefined;
    const id = generateUniqueId((candidate) => this.index.hasId(candidate));
    const now = toLocalIsoString();
    const tags = Array.from(new Set(["旅游/日志", ...(input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)]));
    const body =
      input.body && input.body.trim()
        ? input.body
        : `## ${date} ${place.name}\n\n`;

    const frontmatter: Record<string, unknown> = {
      kind: "travel-log",
      schema_version: 1,
      id,
      place_id: place.id,
      place: this.repo.noteLinkForPath(place.filePath),
      trip: trip ? this.repo.noteLinkForPath(trip.filePath) : undefined,
      visited_start: date,
      visited_end: normalizeDate(input.visitedEnd) ?? date,
      date,
      tags,
      pinned: input.pinned ?? false,
      cover: input.cover?.trim() || undefined,
      created: now,
      updated: now,
    };

    const file = await this.repo.createNote(
      this.repo.logFolder(),
      `${date}-${title}`,
      frontmatter,
      body
    );
    await this.index.refreshFile(file);
    const log = this.index.getLog(id);
    if (!log) throw new Error("旅行日志写入后未能进入索引，请运行「重建旅游索引」");
    return log;
  }

  async togglePinned(logId: string): Promise<boolean> {
    const log = this.index.getLog(logId);
    if (!log) throw new Error(`日志不存在：${logId}`);
    const file = this.repo.getFile(log.filePath);
    if (!file) throw new Error(`日志文件不存在：${log.filePath}`);
    const pinned = !log.pinned;
    await this.repo.setFrontmatter(file, {
      pinned,
      updated: toLocalIsoString(),
    });
    await this.index.refreshFile(file);
    return pinned;
  }

  logsForPlace(placeId: string): LogRecord[] {
    return this.index
      .getLogsForPlace(placeId)
      .sort((a, b) => (b.visitedStart ?? b.date ?? "").localeCompare(a.visitedStart ?? a.date ?? ""));
  }

  async open(log: LogRecord, newLeaf = false): Promise<void> {
    const file = this.repo.getFile(log.filePath);
    if (file) await this.repo.openFile(file, newLeaf);
  }

  placeOf(log: LogRecord): PlaceRecord | undefined {
    return this.index.getPlace(log.placeId);
  }

  tripOf(log: LogRecord): TripRecord | undefined {
    if (!log.tripLink) return undefined;
    return this.index
      .getTrips()
      .find((trip) => log.tripLink?.includes(trip.filePath.replace(/\.md$/i, "")));
  }

  fileOf(log: LogRecord): TFile | null {
    return this.repo.getFile(log.filePath);
  }
}
