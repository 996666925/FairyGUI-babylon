import {
    EventType,
    GRoot,
    UIPackage,
    type Event,
    type GButton,
    type GComponent,
    type GList,
    type GObject,
    type GRichTextField,
    type GTextInput,
} from 'fairygui-babylon';

import { EmojiParser } from './EmojiParser.js';

class Message {
    public sender = '';
    public senderIcon = '';
    public msg = '';
    public fromMe = false;
}

export class ChatDemo {
    private _view!: GComponent;
    private _list!: GList;
    private _input!: GTextInput;
    private _emojiSelectUI!: GComponent;
    private _emojiParser!: EmojiParser;
    private _messages!: Array<Message>;

    constructor() {
        UIPackage.load('ui/Chat').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Chat', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._messages = new Array<Message>();
        this._emojiParser = new EmojiParser();

        this._list = this._view.getChild('list')!.asList;
        this._list.setVirtual();
        this._list.itemProvider = this.getListItemResource.bind(this);
        // The reference handed `renderListItem` to `Laya.Handler`, which did not
        // check the type of the item it passes; the wrapper is what narrows
        // `GObject` down for the item renderer.
        this._list.itemRenderer = (index: number, item: GObject) => this.renderListItem(index, item.asButton);

        this._input = this._view.getChild('input1')!.asTextInput;
        // The reference listened to the Laya `EditBox`'s `ENTER` event; the
        // port's `GTextInput` reports a submit as `SUBMIT` instead.
        this._input.on(EventType.SUBMIT, this.onSubmit, this);

        this._view.getChild('btnSend1')!.onClick(this.onClickSendBtn, this);
        this._view.getChild('btnEmoji1')!.onClick(this.onClickEmojiBtn, this);

        this._emojiSelectUI = UIPackage.createObject('Chat', 'EmojiSelectUI')!.asCom;
        this._emojiSelectUI.getChild('list')!.on(EventType.CLICK_ITEM, this.onClickEmoji, this);
    }

    private addMsg(sender: string, senderIcon: string, msg: string, fromMe: boolean): void {
        const isScrollBottom: boolean = this._list.scrollPane!.isBottomMost;

        const newMessage = new Message();
        newMessage.sender = sender;
        newMessage.senderIcon = senderIcon;
        newMessage.msg = msg;
        newMessage.fromMe = fromMe;
        this._messages.push(newMessage);

        if (newMessage.fromMe) {
            if (this._messages.length == 1 || Math.random() < 0.5) {
                const replyMessage = new Message();
                replyMessage.sender = 'FairyGUI';
                replyMessage.senderIcon = 'r1';
                replyMessage.msg = 'Today is a good day. ';
                replyMessage.fromMe = false;
                this._messages.push(replyMessage);
            }
        }

        if (this._messages.length > 100)
            this._messages.splice(0, this._messages.length - 100);

        this._list.numItems = this._messages.length;

        if (isScrollBottom)
            this._list.scrollPane!.scrollBottom();
    }

    private getListItemResource(index: number): string {
        const msg = this._messages[index];
        if (msg.fromMe)
            return 'ui://Chat/chatRight';
        else
            return 'ui://Chat/chatLeft';
    }

    private renderListItem(index: number, item: GButton): void {
        const msg = this._messages[index];
        if (!msg.fromMe)
            item.getChild('name')!.text = msg.sender;
        item.icon = UIPackage.getItemURL('Chat', msg.senderIcon);

        const txtObj: GRichTextField = item.getChild('msg') as GRichTextField;
        // The reference also copied `maxWidth` onto the Laya `RichText`'s
        // `displayObject` here. There is no display object to reach through in
        // this port: the backend wraps at the field's own width, which
        // `GTextField` keeps in step with the size.
        txtObj.text = this._emojiParser.parse(msg.msg);
        txtObj.ensureSizeCorrect();
    }

    private onClickSendBtn(): void {
        const msg = this._input.text;
        if (!msg)
            return;

        this.addMsg('Creator', 'r0', msg, true);
        this._input.text = '';
    }

    private onClickEmojiBtn(evt: Event): void {
        GRoot.inst.showPopup(this._emojiSelectUI, evt.currentTarget as GObject, false);
    }

    private onClickEmoji(item: GObject): void {
        this._input.text += '[:' + (item.text ?? '') + ']';
    }

    private onSubmit(): void {
        this.onClickSendBtn();
    }
}
