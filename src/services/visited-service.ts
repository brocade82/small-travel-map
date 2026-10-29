import { computeVisitedState, type VisitedState } from "../core/visited";
import { TravelIndex } from "./indexer";

export class VisitedService {
  constructor(private readonly index: TravelIndex) {}

  compute(): VisitedState {
    const logsByPlace = new Map<string, number>();
    for (const log of this.index.getLogs()) {
      if (!log.placeId) continue;
      logsByPlace.set(log.placeId, (logsByPlace.get(log.placeId) ?? 0) + 1);
    }
    return computeVisitedState(
      this.index.getPlaces().map((place) => ({
        id: place.id,
        name: place.name,
        adcode: place.adcode,
        visited: place.visited,
        hasJournals: (logsByPlace.get(place.id) ?? 0) > 0,
        journalCount: logsByPlace.get(place.id) ?? 0,
        lat: place.lat,
        lng: place.lng,
      }))
    );
  }
}
