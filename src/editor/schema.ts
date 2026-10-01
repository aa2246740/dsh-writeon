import { Schema } from 'prosemirror-model'

/**
 * Write On schema.
 *
 * Variant boundaries live IN the document as inline marker nodes (`vstart` /
 * `vend`) for word/sentence scope and as a block container (`vblock`) for
 * paragraph scope, so every boundary moves with normal edits — no
 * position-tracking entity can drift. Ghost is a mark carrying the ghost id.
 */

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', { class: 'wop' }, 0],
      parseDOM: [{ tag: 'p' }],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: node => [`h${node.attrs.level as number}`, { class: 'woh' }, 0],
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
      ],
    },
    /**
     * Paragraph-scope variant container. Its children are the ACTIVE option's
     * blocks; sibling groups nest only fully inside one child block.
     */
    vblock: {
      group: 'block',
      content: 'block+',
      attrs: { gid: { default: '' } },
      marks: '',
      toDOM: node => ['div', { class: 'wovblock', 'data-gid': node.attrs.gid as string }, 0],
      parseDOM: [{ tag: 'div[data-gid]' }],
    },
    vstart: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      attrs: { gid: { default: '' } },
      toDOM: node => ['span', { class: 'wovstart', 'data-gid': node.attrs.gid as string }, '\u200b'],
      parseDOM: [{ tag: 'span[data-gid].wovstart' }],
    },
    vend: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      attrs: { gid: { default: '' } },
      toDOM: node => ['span', { class: 'wovend', 'data-gid': node.attrs.gid as string }, '\u200b'],
      parseDOM: [{ tag: 'span[data-gid].wovend' }],
    },
    text: { inline: true, group: 'inline' },
  },
  marks: {
    ghost: {
      attrs: { sid: { default: '' } },
      toDOM: mark => ['span', { class: 'woghost', 'data-sid': mark.attrs.sid as string }, 0],
      parseDOM: [{ tag: 'span[data-sid].woghost' }],
      excludes: '',
    },
    link: {
      attrs: { href: { default: '' } },
      inclusive: false,
      toDOM: mark => ['a', { href: mark.attrs.href as string, class: 'wolink' }, 0],
      parseDOM: [{ tag: 'a[href]' }],
    },
  },
})

export const { vstart, vend, vblock, paragraph, heading, text } = schema.nodes
export const { ghost, link } = schema.marks

export function emptyDoc() {
  return schema.node('doc', null, [schema.node('paragraph')])
}
