/**
 * mock_dom.js
 * Lightweight DOM & Window Proxy test environment
 * Supports Window.prototype.contentWindow polyfill testing,
 * iframe and script management, and cross-frame postMessage simulation.
 */

class MockElement {
    constructor(tagName, id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.style = {};
        this.attributes = new Map();
        this.children = [];
        this.parentNode = null;
        this.innerHTML = '';
        this.textContent = '';
        this.className = '';
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    querySelectorAll(selector) {
        const results = [];
        const matchTag = selector.toUpperCase();
        const traverse = (el) => {
            for (const child of el.children) {
                if (child.tagName === matchTag || selector === '*') {
                    results.push(child);
                }
                traverse(child);
            }
        };
        traverse(this);
        return results;
    }

    querySelector(selector) {
        const all = this.querySelectorAll(selector);
        return all.length > 0 ? all[0] : null;
    }
}

class MockHTMLScriptElement extends MockElement {
    constructor() {
        super('SCRIPT');
        this.src = '';
        this.async = false;
        this.defer = false;
    }
}

class MockHTMLIFrameElement extends MockElement {
    constructor(id = '', name = '') {
        super('IFRAME', id);
        this.name = name || id;
        this.src = '';
        this.allow = '';
        this._contentWindow = new MockWindowProxy(this);
    }

    get contentWindow() {
        return this._contentWindow;
    }
}

class MockHTMLVideoElement extends MockElement {
    constructor(id = 'videoPlayer') {
        super('VIDEO', id);
        this.src = '';
        this.paused = true;
        this.currentTime = 0;
        this.duration = 0;
        this.loadedCount = 0;
    }

    play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }

    load() {
        this.loadedCount++;
    }
}

class MockWindowProxy {
    constructor(iframeEl = null) {
        this.iframe = iframeEl;
        this.messagesSent = [];
        this.listeners = new Map();
    }

    postMessage(data, targetOrigin) {
        this.messagesSent.push({ data, targetOrigin, timestamp: Date.now() });
        // Dispatch to registered message listeners on window if same environment
        const handlers = this.listeners.get('message') || [];
        for (const handler of handlers) {
            try {
                handler({ data, origin: targetOrigin });
            } catch (err) {}
        }
    }

    addEventListener(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(handler);
    }

    removeEventListener(event, handler) {
        if (!this.listeners.has(event)) return;
        const list = this.listeners.get(event);
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
    }
}

class MockDocument extends MockElement {
    constructor() {
        super('#DOCUMENT');
        this.head = new MockElement('HEAD');
        this.body = new MockElement('BODY');
        this.appendChild(this.head);
        this.appendChild(this.body);
    }

    createElement(tagName) {
        switch (tagName.toLowerCase()) {
            case 'script':
                return new MockHTMLScriptElement();
            case 'iframe':
                return new MockHTMLIFrameElement();
            case 'video':
                return new MockHTMLVideoElement();
            default:
                return new MockElement(tagName);
        }
    }

    getElementsByTagName(tagName) {
        return this.querySelectorAll(tagName);
    }

    getElementById(id) {
        let found = null;
        const traverse = (el) => {
            if (found) return;
            if (el.id === id) {
                found = el;
                return;
            }
            for (const c of el.children) {
                traverse(c);
            }
        };
        traverse(this);
        return found;
    }
}

class MockWindow {
    constructor() {
        this.document = new MockDocument();
        this.frames = {};
        this.listeners = new Map();
        this.messagesReceived = [];
        this.scrollToCalled = [];
    }

    addEventListener(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(handler);
    }

    removeEventListener(event, handler) {
        if (!this.listeners.has(event)) return;
        const list = this.listeners.get(event);
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
    }

    dispatchEvent(event, data) {
        const list = this.listeners.get(event) || [];
        for (const fn of list) {
            try {
                fn(data);
            } catch (err) {}
        }
    }

    scrollTo(opts) {
        this.scrollToCalled.push(opts);
    }

    postMessage(data, targetOrigin) {
        this.messagesReceived.push({ data, targetOrigin, timestamp: Date.now() });
        const handlers = this.listeners.get('message') || [];
        for (const handler of handlers) {
            try {
                handler({ data, origin: targetOrigin });
            } catch (err) {}
        }
    }

    /**
     * Apply the contentWindow polyfill on this Window instance
     */
    applyContentWindowPolyfill() {
        if (!('contentWindow' in this)) {
            Object.defineProperty(this, 'contentWindow', {
                get: function() { return this; },
                configurable: true
            });
            return true;
        }
        return false;
    }
}

module.exports = {
    MockElement,
    MockHTMLScriptElement,
    MockHTMLIFrameElement,
    MockHTMLVideoElement,
    MockWindowProxy,
    MockDocument,
    MockWindow
};
