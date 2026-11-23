/**
 * Thumbnail grid that fills the section it sits in.
 *
 * Column count follows that width: two thumbnails on a phone, more across a
 * wide booking page. Admin Pickup Photos and the driver portal Condition
 * Photos both use PHOTO_THUMBNAIL_GRID_CLASS, so each grid fills its section.
 *
 * 7rem tracks: two columns fit the booking page on a 360px phone, and a
 * full-width section inside the booking record shows more than six.
 */
export const PHOTO_THUMBNAIL_MIN_PX = 7 * 16;
export const PHOTO_THUMBNAIL_GAP_PX = 8;

export const PHOTO_THUMBNAIL_GRID_CLASS =
  "grid w-full min-w-0 gap-2 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]";

/** How many columns auto-fill uses at this section width. */
export function photoThumbnailColumns(sectionWidthPx: number): number {
  if (!Number.isFinite(sectionWidthPx) || sectionWidthPx <= 0) return 1;
  const tracks = Math.floor(
    (sectionWidthPx + PHOTO_THUMBNAIL_GAP_PX) / (PHOTO_THUMBNAIL_MIN_PX + PHOTO_THUMBNAIL_GAP_PX),
  );
  return Math.max(1, tracks);
}
