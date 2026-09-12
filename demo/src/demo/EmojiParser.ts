import { UBBParser, UIPackage } from 'fairygui-babylon';

export class EmojiParser extends UBBParser {

    public constructor() {
        super();

        TAGS.forEach(element => {
            this._handlers[':' + element] = this.onTag_Emoji;
        });
    }

    private onTag_Emoji(tagName: string, _end: boolean, _attr: string | null): string {
        let i = TAGS.indexOf(tagName.substring(1).toLowerCase()).toString();
        if (i.length == 1)
            i = '0' + i;
        return "<img src='" + (UIPackage.getItemURL('Chat', '1f6' + i) ?? '') + "'/>";
    }
}

const TAGS: Array<string> = ['88', 'am', 'bs', 'bz', 'ch', 'cool', 'dhq', 'dn', 'fd', 'gz', 'han', 'hx', 'hxiao', 'hxiu'];
