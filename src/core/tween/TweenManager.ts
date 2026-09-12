import { GTweener } from './GTweener.js';

const _activeTweens: Array<GTweener | null> = new Array<GTweener | null>(30);
const _tweenerPool: Array<GTweener> = new Array<GTweener>();
let _totalActiveTweens: number = 0;

/**
 * Duck-typed replacement for the reference's `target instanceof GObject &&
 * target.node == null`: a FairyGUI object whose node is gone, or which already
 * reports itself disposed, can no longer be tweened. Plain-object targets are
 * never considered gone.
 */
function isTargetGone(target: any): boolean {
    if (target == null)
        return false;
    if (target.node === null)
        return true;
    return target.disposed === true;
}

export class TweenManager {
    /**
     * Takes a tweener out of the pool, ready to be configured. The reference
     * installed a persistent Cocos node here and scheduled `update` on the
     * director; without an engine, the host is responsible for calling
     * `TweenManager.update(dt)` every frame.
     */
    public static createTween(): GTweener {
        let tweener: GTweener;
        const cnt: number = _tweenerPool.length;
        if (cnt > 0) {
            tweener = _tweenerPool.pop()!;
        }
        else
            tweener = new GTweener();
        tweener._init();
        _activeTweens[_totalActiveTweens++] = tweener;

        if (_totalActiveTweens == _activeTweens.length)
            _activeTweens.length = _activeTweens.length + Math.ceil(_activeTweens.length * 0.5);

        return tweener;
    }

    public static isTweening(target: any, propType?: any): boolean {
        if (target == null)
            return false;

        const anyType: boolean = propType == null || propType == undefined;
        for (let i: number = 0; i < _totalActiveTweens; i++) {
            const tweener: GTweener | null = _activeTweens[i];
            if (tweener && tweener.target == target && !tweener._killed
                && (anyType || tweener._propType == propType))
                return true;
        }

        return false;
    }

    public static killTweens(target: any, completed?: boolean, propType?: any): boolean {
        if (target == null)
            return false;

        let flag: boolean = false;
        const cnt: number = _totalActiveTweens;
        const anyType: boolean = propType == null || propType == undefined;
        for (let i: number = 0; i < cnt; i++) {
            const tweener: GTweener | null = _activeTweens[i];
            if (tweener && tweener.target == target && !tweener._killed
                && (anyType || tweener._propType == propType)) {
                tweener.kill(completed);
                flag = true;
            }
        }

        return flag;
    }

    public static getTween(target: any, propType?: any): GTweener | null {
        if (target == null)
            return null;

        const cnt: number = _totalActiveTweens;
        const anyType: boolean = propType == null || propType == undefined;
        for (let i: number = 0; i < cnt; i++) {
            const tweener: GTweener | null = _activeTweens[i];
            if (tweener && tweener.target == target && !tweener._killed
                && (anyType || tweener._propType == propType)) {
                return tweener;
            }
        }

        return null;
    }

    /** Advances every live tweener by `dt` seconds and retires the finished ones. */
    public static update(dt: number): void {
        const tweens: Array<GTweener | null> = _activeTweens;
        let cnt: number = _totalActiveTweens;
        let freePosStart: number = -1;
        let i: number;
        for (i = 0; i < cnt; i++) {
            const tweener: GTweener | null = tweens[i];
            if (tweener == null) {
                if (freePosStart == -1)
                    freePosStart = i;
            }
            else if (tweener._killed) {
                tweener._reset();
                _tweenerPool.push(tweener);
                tweens[i] = null;

                if (freePosStart == -1)
                    freePosStart = i;
            }
            else {
                if (isTargetGone(tweener._target))
                    tweener._killed = true;
                else if (!tweener._paused)
                    tweener._update(dt);

                if (freePosStart != -1) {
                    tweens[freePosStart] = tweener;
                    tweens[i] = null;
                    freePosStart++;
                }
            }
        }

        if (freePosStart >= 0) {
            if (_totalActiveTweens != cnt) //new tweens added
            {
                let j: number = cnt;
                cnt = _totalActiveTweens - cnt;
                for (i = 0; i < cnt; i++)
                    tweens[freePosStart++] = tweens[j++];
            }
            _totalActiveTweens = freePosStart;
        }
    }
}
