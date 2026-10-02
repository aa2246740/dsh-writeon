import type { WriteOnController } from './controller.js';
import { dictionaries } from './i18n.js';
type I18nKey = keyof typeof dictionaries.en;
type T = (key: I18nKey) => string;
interface PageProps {
    controller: WriteOnController;
    t: T;
    /** Switch the DSH main panel (used by "back to chat"). */
    selectPanel: (id: string | null) => void;
}
/** The workspace root: toolbar + doc list + editor canvas + side panel. */
export declare function WriteOnPage(props: PageProps): import("react").JSX.Element;
export {};
