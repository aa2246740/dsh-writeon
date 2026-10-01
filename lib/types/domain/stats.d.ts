/** Document statistics for the status bar and share preview. */
export interface DocStats {
    words: number;
    chars: number;
    /** Estimated reading minutes at 220 wpm EN / 300 cpm CJK blend — coarse. */
    minutes: number;
    paragraphs: number;
    sentences: number;
}
export declare function computeStats(leaves: {
    text: string;
}[]): DocStats;
