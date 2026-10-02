import type { WriteOnController } from './controller.js';
type I18nKey = keyof typeof import('./i18n.js').dictionaries.en;
type T = (key: I18nKey) => string;
interface PageProps {
    controller: WriteOnController;
    t: T;
    /** Switch the DSH main panel (used by "back to chat"). */
    selectPanel: (id: string | null) => void;
    /** Host locale runtime — subscribed so the panel re-renders on language change. */
    locale?: {
        subscribe(fn: () => void): () => void;
        getSnapshot(): {
            revision: number;
        };
    };
}
/** The workspace root: toolbar + doc list + editor canvas + side panel. */
export declare function WriteOnPage(props: PageProps): import("react").JSX.Element;
export {};
