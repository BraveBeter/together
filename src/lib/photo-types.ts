export type Coordinates = { lat: number; lng: number };
export type PhotoLocation = Coordinates & { place: string; source: "exif" | "manual" | "amap" };
export type OriginalPhotoMetadata = { capturedAt: string | null; offset: string | null; latitude: number | null; longitude: number | null };
export type Photo = {
  id: string; assetId: string; caption: string; width: number; height: number;
  takenOn: string | null; originalMetadata: OriginalPhotoMetadata;
  latitude: number | null; longitude: number | null; place: string;
  locationSource: PhotoLocation["source"] | null; tripId: string | null; tripTitle: string | null;
  uploadedBy: string; participants: string[]; commentCount: number;
  revision: number; createdAt: number; updatedAt: number; deletedAt: number | null;
};
export type PhotoComment = { id: string; photoId: string; authorId: string; body: string; revision: number; createdAt: number; updatedAt: number };
export type Trip = { id: string; title: string; description: string; coverPhotoId: string | null; coverAssetId: string | null; photoCount: number; startedOn: string | null; endedOn: string | null; revision: number };
export type PhotoPage = { items: Photo[]; total: number; cursor: string | null; years: string[]; trips: Trip[] };
export type PhotoPoint = Coordinates & { id: string; assetId: string; takenOn: string | null; place: string; tripId: string | null; participants: string[] };
export type PhotoMoment = { type: "photos"; id: string; date: string | null; order: number; title: string; tripId: string | null; total: number; located: number; photos: Pick<Photo, "id" | "assetId" | "caption" | "place">[] };
export type PlaceResult = PhotoLocation & { id: string; address: string };
