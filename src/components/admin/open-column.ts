/**
 * The Open header and the Open button share this box.
 *
 * Do not add `sticky` or `right-0`. The list header is already
 * position:sticky with a top inset (styles.css). A right inset on that
 * same sticky header slides the word Open to the edge of the page,
 * past the button. A percentage-width column did the same thing: the
 * label sat at the far right of leftover space, not on the button.
 */
export const OPEN_COLUMN = "w-[4.75rem] min-w-[4.75rem] whitespace-nowrap px-2 text-center align-middle";

/** The row "..." menu. Unlabeled, and not part of the Open column. */
export const ROW_MENU_COLUMN = "w-10 whitespace-nowrap px-1 text-center align-middle";
