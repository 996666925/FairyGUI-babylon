import { ObjectType } from './FieldTypes.js';
import type { PackageItem } from './PackageItem.js';
import type { ByteBuffer } from './utils/ByteBuffer.js';

const XML_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeEntities(text: string): string {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
        if (body.charAt(0) === '#') {
            const code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
                ? parseInt(body.substring(2), 16)
                : parseInt(body.substring(1), 10);
            return isNaN(code) ? match : String.fromCharCode(code);
        }
        return XML_ENTITIES[body] ?? match;
    });
}

/**
 * Applies a translation table to package data.
 *
 * Translation is a **rewrite of the package buffer itself**: `translateComponent`
 * walks a component's payload and overwrites the string-table slots holding
 * text, tooltips and list item titles in place. Everything downstream —
 * including a second instance built from the same package — then reads the
 * translated strings with no further involvement.
 *
 * Parsing is done with a small regex rather than `DOMParser` so this works in
 * Node, where tests run and there is no DOM. The translation file the editor
 * emits is a flat list of `<string name="…">…</string>` elements, which a
 * full XML parser is not needed for.
 */
export class TranslationHelper {
    /** Keys are `<packageId><itemId>`, then `<elementId>-<suffix>` within. */
    public static strings: Record<string, Record<string, string>> | null = null;

    public static loadFromXML(source: string): void {
        const strings: Record<string, Record<string, string>> = {};
        TranslationHelper.strings = strings;

        const re = /<string\s+name\s*=\s*"([^"]*)"\s*(?:\/>|>([\s\S]*?)<\/string\s*>)/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
            const key = decodeEntities(match[1]);
            const text = match[2] !== undefined ? decodeEntities(match[2]) : '';

            // Keys are "<packageItemId>-<element>-…"; the first dash splits the
            // owning component from everything else.
            const i = key.indexOf('-');
            if (i === -1)
                continue;

            const ownerKey = key.substring(0, i);
            const innerKey = key.substring(i + 1);
            const col = strings[ownerKey] ?? (strings[ownerKey] = {});
            col[innerKey] = text;
        }
    }

    public static translateComponent(item: PackageItem): void {
        const strings = TranslationHelper.strings;
        if (strings == null)
            return;

        const compStrings = strings[item.owner.id + item.id];
        if (compStrings == null)
            return;

        const buffer: ByteBuffer = item.rawData!;
        buffer.seek(0, 2);

        const childCount = buffer.readShort();
        for (let i = 0; i < childCount; i++) {
            const dataLen = buffer.readShort();
            const curPos = buffer.position;

            buffer.seek(curPos, 0);

            const baseType: number = buffer.readByte();
            let type = baseType;
            buffer.skip(4);
            const elementId = buffer.readS() as string;

            if (type === ObjectType.Component) {
                // A nested component may itself be one of the widget types.
                if (buffer.seek(curPos, 6))
                    type = buffer.readByte();
            }

            buffer.seek(curPos, 1);
            let value = compStrings[elementId + '-tips'];
            if (value != null)
                buffer.writeS(value);

            // -- gear text --
            buffer.seek(curPos, 2);
            const gearCnt = buffer.readShort();
            for (let j = 0; j < gearCnt; j++) {
                let nextPos = buffer.readShort();
                nextPos += buffer.position;

                if (buffer.readByte() === 6) { // gearText
                    buffer.skip(2); // controller index
                    const valueCnt = buffer.readShort();
                    for (let k = 0; k < valueCnt; k++) {
                        const page = buffer.readS();
                        if (page == null)
                            continue;
                        value = compStrings[elementId + '-texts_' + k];
                        if (value != null)
                            buffer.writeS(value);
                        else
                            buffer.skip(2);
                    }

                    value = compStrings[elementId + '-texts_def'];
                    if (buffer.readBool() && value != null)
                        buffer.writeS(value);
                }

                buffer.position = nextPos;
            }

            // -- component child properties --
            if (baseType === ObjectType.Component && buffer.version >= 2) {
                buffer.seek(curPos, 4);
                buffer.skip(2); // pageController
                buffer.skip(4 * buffer.readShort());

                const cpCount = buffer.readShort();
                for (let k = 0; k < cpCount; k++) {
                    const target = buffer.readS() as string;
                    const propertyId = buffer.readShort();
                    value = compStrings[elementId + '-cp-' + target];
                    if (propertyId === 0 && value != null)
                        buffer.writeS(value);
                    else
                        buffer.skip(2);
                }
            }

            switch (type) {
                case ObjectType.Text:
                case ObjectType.RichText:
                case ObjectType.InputText: {
                    value = compStrings[elementId];
                    if (value != null) {
                        buffer.seek(curPos, 6);
                        buffer.writeS(value);
                    }
                    value = compStrings[elementId + '-prompt'];
                    if (value != null) {
                        buffer.seek(curPos, 4);
                        buffer.writeS(value);
                    }
                    break;
                }

                case ObjectType.List:
                case ObjectType.Tree: {
                    buffer.seek(curPos, 8);
                    buffer.skip(2);
                    const itemCount = buffer.readShort();
                    for (let j = 0; j < itemCount; j++) {
                        let nextPos = buffer.readShort();
                        nextPos += buffer.position;

                        buffer.skip(2); // url
                        if (type === ObjectType.Tree)
                            buffer.skip(2);

                        value = compStrings[elementId + '-' + j];
                        if (value != null)
                            buffer.writeS(value);
                        else
                            buffer.skip(2);

                        value = compStrings[elementId + '-' + j + '-0'];
                        if (value != null)
                            buffer.writeS(value);
                        else
                            buffer.skip(2);

                        if (buffer.version >= 2) {
                            buffer.skip(6);
                            buffer.skip(buffer.readUshort() * 4); // controllers

                            const cpCount = buffer.readUshort();
                            for (let k = 0; k < cpCount; k++) {
                                const target = buffer.readS() as string;
                                const propertyId = buffer.readUshort();
                                value = compStrings[elementId + '-' + j + '-' + target];
                                if (propertyId === 0 && value != null)
                                    buffer.writeS(value);
                                else
                                    buffer.skip(2);
                            }
                        }

                        buffer.position = nextPos;
                    }
                    break;
                }

                case ObjectType.Label: {
                    if (buffer.seek(curPos, 6) && buffer.readByte() === type) {
                        value = compStrings[elementId];
                        if (value != null)
                            buffer.writeS(value);
                        else
                            buffer.skip(2);

                        buffer.skip(2);
                        if (buffer.readBool())
                            buffer.skip(4);
                        buffer.skip(4);

                        value = compStrings[elementId + '-prompt'];
                        if (buffer.readBool() && value != null)
                            buffer.writeS(value);
                    }
                    break;
                }

                case ObjectType.Button: {
                    if (buffer.seek(curPos, 6) && buffer.readByte() === type) {
                        value = compStrings[elementId];
                        if (value != null)
                            buffer.writeS(value);
                        else
                            buffer.skip(2);

                        value = compStrings[elementId + '-0'];
                        if (value != null)
                            buffer.writeS(value);
                    }
                    break;
                }

                case ObjectType.ComboBox: {
                    if (buffer.seek(curPos, 6) && buffer.readByte() === type) {
                        const itemCount = buffer.readShort();
                        for (let j = 0; j < itemCount; j++) {
                            let nextPos = buffer.readShort();
                            nextPos += buffer.position;

                            value = compStrings[elementId + '-' + j];
                            if (value != null)
                                buffer.writeS(value);

                            buffer.position = nextPos;
                        }

                        value = compStrings[elementId];
                        if (value != null)
                            buffer.writeS(value);
                    }
                    break;
                }
            }

            buffer.position = curPos + dataLen;
        }
    }
}

/** Convenience wrapper matching the reference's static entry point. */
export function translateComponent(item: PackageItem): void {
    TranslationHelper.translateComponent(item);
}
