import { _decorator, Component, Node, UITransform, Vec3, view, Button, EditBox, Label } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('NewComponent')
export class NewComponent extends Component {
    @property(Node)
    juese: Node | null = null;
    
    // 输入框节点（在编辑器里拖拽绑定）
    @property(Node)
    inputBox: Node | null = null;

    // 按钮节点（如果你不想手动拖拽，也可以不填；脚本会尝试按名字找 `anniu1`）
    @property(Node)
    anniu1: Node | null = null;
    

    private _moveState: number = 0; // 0: left->right, 1: right->center, 2: done
    private _elapsed: number = 0;
    private _durLeftToRight: number = 1.2;
    private _durRightToCenter: number = 1.2;

    private _leftX: number = -640;
    private _rightX: number = 640;
    private _centerX: number = 0;
    private _fixedY: number = 0;
    private _fixedZ: number = 0;
    private _boundAnniu1ClickEvents: Array<string | number> = [];
    private _boundAnniu1Node: Node | null = null;
    private _outputLabel: Label | null = null;

    onLoad() {
        // 不依赖控制台：点击按钮后把结果写到场景里的 Label
        const labelNode = this.node.getChildByName?.('Label');
        if (labelNode) {
            this._outputLabel = labelNode.getComponent(Label) ?? null;
        } else {
            // 兜底：如果 Label 不在直接子节点，尝试在子树里找
            this._outputLabel = (this.node as any).getComponentInChildren?.(Label) ?? null;
        }

        console.log('[NewComponent] onLoad:', {
            nodeName: this.node?.name,
            hasInputBox: !!this.inputBox,
            hasAnniu1: !!this.anniu1,
            outputLabelFound: !!this._outputLabel,
        });
    }
    
    start() {
        console.log('[NewComponent] start:', {
            nodeName: this.node?.name,
            hasInputBox: !!this.inputBox,
            inputBoxName: this.inputBox?.name,
            hasAnniu1: !!this.anniu1,
            anniu1Name: this.anniu1?.name,
        });

        // 如果编辑器里已经绑定了角色节点，就直接用；否则自动创建一个
        if (!this.juese) {
            this.juese = new Node('Player');
            this.node.addChild(this.juese);
        }

        // 绑定按钮点击事件：读取输入框内容
        const btnNode = this.anniu1 ?? this.node.getChildByName?.('anniu1');
        if (btnNode) {
            const btn = btnNode.getComponent(Button);
            if (btn) {
                // 不同 Creator 版本的 Button 事件名可能略有差异，这里做一下兼容
                const clickEnum = (Button as any)?.EventType?.CLICK;
                const eventNames: Array<string | number> = [];
                if (clickEnum !== undefined) eventNames.push(clickEnum);
                if (clickEnum !== 'click') eventNames.push('click');

                this._boundAnniu1ClickEvents = eventNames;
                this._boundAnniu1Node = btnNode;
                for (const eventName of eventNames) {
                    btnNode.on(eventName as any, this.onAnniu1Click, this);
                }

                console.log('[NewComponent] button bound:', {
                    btnNodeName: btnNode?.name,
                    events: eventNames,
                });
            } else {
                console.warn('[NewComponent] `anniu1` 节点没有找到 Button 组件');
            }
        } else {
            console.warn('[NewComponent] 没有找到按钮节点 `anniu1`，请在编辑器里拖拽绑定或保证场景里存在同名节点');
        }

        const role = this.juese;

        // 计算左右/中间（在 role 的父节点坐标系下）
        const refNode = role.parent ?? this.node;
        const ui = refNode.getComponent(UITransform);
        const width = ui ? ui.contentSize.width : view.getVisibleSize().width;

        // UITransform 的 anchorPoint 决定局部原点与屏幕边界的对应关系
        const anchorX = ui ? ui.anchorPoint.x : 0.5;
        this._leftX = -anchorX * width;
        this._rightX = (1 - anchorX) * width;
        this._centerX = (0.5 - anchorX) * width;

        const startPos = role.position;
        this._fixedY = startPos.y;
        this._fixedZ = startPos.z;

        // 先把角色放到屏幕左侧，然后在 update 里按顺序移动
        role.setPosition(new Vec3(this._leftX, this._fixedY, this._fixedZ));
        this._moveState = 0;
        this._elapsed = 0;
    }

    private onAnniu1Click() {
        console.log('[NewComponent] onAnniu1Click fired');

        if (!this.inputBox) {
            if (this._outputLabel) this._outputLabel.string = 'inputBox 未绑定';
            console.warn('[NewComponent] inputBox 未绑定');
            return;
        }

        let editBox = this.inputBox.getComponent(EditBox);
        if (!editBox) {
            // 有些场景里 EditBox 挂在 inputBox 的子节点上，这里兜底在子树里找
            editBox = (this.inputBox as any).getComponentInChildren?.(EditBox) ?? null;
        }

        if (!editBox) {
            if (this._outputLabel) this._outputLabel.string = 'inputBox 上没有 EditBox';
            console.warn('[NewComponent] inputBox 上没有找到 EditBox');
            return;
        }

        const text = editBox.string ?? '';
        if (this._outputLabel) this._outputLabel.string = text;
        console.log('[NewComponent] inputBox text =', text);
    }

    onDestroy() {
        if (!this._boundAnniu1Node) return;
        if (this._boundAnniu1ClickEvents.length === 0) return;
        for (const eventName of this._boundAnniu1ClickEvents) {
            this._boundAnniu1Node.off(eventName as any, this.onAnniu1Click, this);
        }
    }

    update(deltaTime: number) {
        if (!this.juese) return;

        this._elapsed += deltaTime;

        if (this._moveState === 0) {
            const t = Math.min(this._elapsed / this._durLeftToRight, 1);
            const x = this._leftX + (this._rightX - this._leftX) * t;
            this.juese.setPosition(new Vec3(x, this._fixedY, this._fixedZ));

            if (t >= 1) {
                this._moveState = 1;
                this._elapsed = 0;
            }
            return;
        }

        if (this._moveState === 1) {
            const t = Math.min(this._elapsed / this._durRightToCenter, 1);
            const x = this._rightX + (this._centerX - this._rightX) * t;
            this.juese.setPosition(new Vec3(x, this._fixedY, this._fixedZ));

            if (t >= 1) {
                this._moveState = 2;
            }
        }
    }
}


