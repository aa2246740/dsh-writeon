import { IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** Pen glyph for the Write On sidebar entry; the sidebar owns the label text. */
export function WriteOnIcon({ size }: { size?: number }) {
  return <IconListPenOutlineRegular size={size} />
}
