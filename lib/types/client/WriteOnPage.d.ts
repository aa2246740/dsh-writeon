import type { WriteOnController } from './controller.js';
type T = (key: keyof typeof import('./i18n.js').dictionaries.en) => string;
interface PageProps {
    controller: WriteOnController;
    t: T;
    /** Switch the DSH main panel (used by "back to chat"). */
    selectPanel: (id: string | null) => void;
}
/** The workspace root: toolbar + doc list + editor canvas + side panel. */
export declare function WriteOnPage(props: PageProps): import("react").JSX.Element;
export {};
