// 英語学習アプリのVueアプリ本体。フロントエンド担当が管理する。
const { createApp } = Vue;

createApp({
    data() {
        return {
            documents: [],
            current: null,
            inputText: '',
            isTranslating: false,
            isExtracting: false,
            error: '',
            revealed: {},
            quizMode: false,
            quizWords: [],
            quizIndex: 0,
            quizRevealed: false,
            quizFinished: false,
            knownCount: 0,
            quizAnswers: [],
            lastWrongWords: [],
            wordStatus: {},
            draggingWord: null,
            dragSourceZone: '',
            dragOverZone: '',
            wordDroppedInside: false,
            lastDragPoint: null,
            deleteDropReady: false,
            dragJustEnded: false,
            sidebarOpen: false,
            menuOpen: false,
            focusPane: 'both',   // 'both' | 'en' | 'ja' — 英日どちらかを最大化する
            wordCollapsed: false,
            settings: { level: 'intermediate', autoArchiveKnown: false }
        };
    },
    computed: {
        visibleWords() {
            return (this.current?.words || []).filter((word) => !this.isDeletedWord(word.word));
        },
        activeWords() {
            return this.visibleWords.filter((word) => !this.isArchivedWord(word.word));
        },
        archivedWords() {
            return this.visibleWords.filter((word) => this.isArchivedWord(word.word));
        },
        currentWordCount() {
            return this.visibleWords.length;
        },
        reviewWords() {
            return this.lastWrongWords.filter((word) => !this.isArchivedWord(word.word) && !this.isDeletedWord(word.word));
        },
        wrongCount() {
            return this.reviewWords.length;
        }
    },
    async mounted() {
        this.loadSettings();
        await this.fetchDocuments();
        if (window.lucide) this.$nextTick(() => window.lucide.createIcons());
    },
    updated() {
        if (window.lucide) this.$nextTick(() => window.lucide.createIcons());
    },
    methods: {
        loadSettings() {
            // 設定はブラウザのlocalStorageに保存する(端末ごと)
            try {
                const saved = localStorage.getItem('appSettings');
                if (saved) this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) { /* 読めない環境では既定値のまま */ }
        },
        saveSettings() {
            try {
                localStorage.setItem('appSettings', JSON.stringify(this.settings));
            } catch (e) { /* 保存できない環境では無視 */ }
        },
        async uploadFile() {
            const file = this.$refs.fileInput.files[0];
            if (!file) {
                this.error = 'ファイルを選択してください。';
                return;
            }
            this.isTranslating = true;
            this.error = '';
            try {
                const formData = new FormData();
                formData.append('file', file);
                const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                this.current = data;
                this.revealed = {};
                this.loadWordStatus();
                await this.fetchDocuments();
            } catch (e) {
                this.error = e.message || 'ファイルの読み込みに失敗しました。';
            } finally {
                this.isTranslating = false;
            }
        },
        async fetchDocuments() {
            try {
                const res = await fetch('/api/documents');
                this.documents = await res.json();
            } catch (e) {
                this.error = '文章一覧の取得に失敗しました。';
            }
        },
        newDocument() {
            this.current = null;
            this.inputText = '';
            this.error = '';
            this.quizMode = false;
            this.lastWrongWords = [];
            this.sidebarOpen = false;
        },
        async deleteDocument(id) {
            if (!confirm('この文章を削除しますか？')) return;
            try {
                const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error();
                if (this.current && this.current.id === id) this.current = null;
                await this.fetchDocuments();
            } catch (e) {
                this.error = '削除に失敗しました。';
            }
        },
        async selectDocument(id) {
            this.error = '';
            this.quizMode = false;
            this.revealed = {};
            this.sidebarOpen = false;
            try {
                const res = await fetch(`/api/documents/${id}`);
                if (!res.ok) throw new Error();
                this.current = await res.json();
                this.loadWordStatus();
            } catch (e) {
                this.error = '文章の読み込みに失敗しました。';
            }
        },
        async translate() {
            if (!this.inputText.trim()) {
                this.error = '英文を入力してください。';
                return;
            }
            this.isTranslating = true;
            this.error = '';
            try {
                const res = await fetch('/api/documents', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: this.inputText })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                this.current = data;
                this.revealed = {};
                this.loadWordStatus();
                await this.fetchDocuments();
            } catch (e) {
                this.error = e.message || '翻訳に失敗しました。';
            } finally {
                this.isTranslating = false;
            }
        },
        async createWordbook() {
            this.isExtracting = true;
            this.error = '';
            try {
                const res = await fetch(`/api/documents/${this.current.id}/words`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ level: this.settings.level })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                this.current.words = data;
                this.revealed = {};
                this.wordStatus = {};
                this.lastWrongWords = [];
                this.saveWordStatus();
            } catch (e) {
                this.error = e.message || '単語帳の作成に失敗しました。';
            } finally {
                this.isExtracting = false;
            }
        },
        toggleWord(word) {
            if (this.dragJustEnded) return;
            this.revealed[word] = !this.revealed[word];
        },
        wordKey(word) {
            return String(word || '').trim().toLowerCase();
        },
        wordStatusKey() {
            return this.current ? `wordStatus:${this.current.id}` : '';
        },
        loadWordStatus() {
            this.wordStatus = {};
            this.lastWrongWords = [];
            if (!this.current) return;
            try {
                const saved = localStorage.getItem(this.wordStatusKey());
                this.wordStatus = saved ? JSON.parse(saved) : {};
            } catch (e) {
                this.wordStatus = {};
            }
        },
        saveWordStatus() {
            if (!this.current) return;
            try {
                localStorage.setItem(this.wordStatusKey(), JSON.stringify(this.wordStatus));
            } catch (e) { /* 保存できない環境では現在画面だけ反映 */ }
        },
        isArchivedWord(word) {
            return this.wordStatus[this.wordKey(word)] === 'archived';
        },
        isDeletedWord(word) {
            return this.wordStatus[this.wordKey(word)] === 'deleted';
        },
        archiveWord(word) {
            const key = this.wordKey(word);
            this.wordStatus[key] = 'archived';
            this.lastWrongWords = this.lastWrongWords.filter((w) => this.wordKey(w.word) !== key);
            this.saveWordStatus();
        },
        restoreWord(word) {
            delete this.wordStatus[this.wordKey(word)];
            this.saveWordStatus();
        },
        deleteWord(word) {
            const key = this.wordKey(word);
            this.wordStatus[key] = 'deleted';
            this.lastWrongWords = this.lastWrongWords.filter((w) => this.wordKey(w.word) !== key);
            delete this.revealed[word];
            this.saveWordStatus();
        },
        toggleFocus(pane) {
            this.focusPane = this.focusPane === pane ? 'both' : pane;
        },
        startWordDrag(word, sourceZone, event) {
            this.draggingWord = word;
            this.dragSourceZone = sourceZone;
            this.dragOverZone = '';
            this.wordDroppedInside = false;
            this.lastDragPoint = this.getDragPoint(event);
            this.deleteDropReady = false;
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', word.word);
            }
        },
        getDragPoint(event) {
            const point = event.touches?.[0] || event.changedTouches?.[0] || event;
            if (!Number.isFinite(point?.clientX) || !Number.isFinite(point?.clientY)) {
                return this.lastDragPoint;
            }
            if (point.clientX === 0 && point.clientY === 0) {
                return this.lastDragPoint;
            }
            return { x: point.clientX, y: point.clientY };
        },
        trackWordDrag(event) {
            if (!this.draggingWord) return;
            const point = this.getDragPoint(event);
            if (point) {
                this.lastDragPoint = point;
                this.deleteDropReady = this.isOutsideWordArea(point);
            }
        },
        handleAppDragOver(event) {
            if (!this.draggingWord) return;
            event.preventDefault();
            this.trackWordDrag(event);
        },
        handleAppDrop(event) {
            if (!this.draggingWord) return;
            event.preventDefault();
            this.trackWordDrag(event);
            if (!this.wordDroppedInside && this.isOutsideWordArea(this.lastDragPoint)) {
                this.deleteWord(this.draggingWord.word);
                this.error = '';
                this.wordDroppedInside = true;
            }
            this.endWordDrag();
        },
        dragOverWordZone(zone, event) {
            if (!this.draggingWord) return;
            this.trackWordDrag(event);
            this.dragOverZone = zone;
            this.deleteDropReady = false;
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = zone === this.dragSourceZone ? 'none' : 'move';
            }
        },
        leaveWordZone(zone, event) {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            if (this.dragOverZone === zone) {
                this.dragOverZone = '';
            }
        },
        dropWord(zone, event) {
            this.wordDroppedInside = true;
            const droppedWord = this.draggingWord?.word || event.dataTransfer?.getData('text/plain');
            if (!droppedWord) {
                this.endWordDrag();
                return;
            }

            if (zone === 'archived') {
                this.archiveWord(droppedWord);
            } else {
                this.restoreWord(droppedWord);
            }
            this.error = '';
            this.endWordDrag();
        },
        isOutsideWordArea(point) {
            if (!point) return false;
            const area = document.querySelector('.word-area');
            if (!area) return false;
            const rect = area.getBoundingClientRect();
            return point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom;
        },
        endWordDrag(event) {
            if (!this.draggingWord && this.dragJustEnded) return;
            const movedByDrag = Boolean(this.draggingWord);
            const draggedWord = this.draggingWord?.word;
            const point = this.getDragPoint(event || {});
            if (point) this.lastDragPoint = point;
            if (draggedWord && !this.wordDroppedInside && this.isOutsideWordArea(this.lastDragPoint)) {
                this.deleteWord(draggedWord);
                this.error = '';
            }
            this.draggingWord = null;
            this.dragSourceZone = '';
            this.dragOverZone = '';
            this.wordDroppedInside = false;
            this.lastDragPoint = null;
            this.deleteDropReady = false;
            if (movedByDrag) {
                this.dragJustEnded = true;
                window.setTimeout(() => {
                    this.dragJustEnded = false;
                }, 80);
            }
        },
        startQuiz(mode = 'active') {
            // 単語帳は無制限だが、クイズは1回ランダム10問固定
            const sourceWords = mode === 'wrong' ? this.reviewWords : this.activeWords;
            if (!sourceWords.length) {
                this.error = mode === 'wrong'
                    ? '復習する単語がありません。'
                    : '出題する単語がありません。';
                return;
            }
            this.error = '';
            this.quizWords = [...sourceWords].sort(() => Math.random() - 0.5).slice(0, 10);
            this.quizIndex = 0;
            this.quizRevealed = false;
            this.quizFinished = false;
            this.knownCount = 0;
            this.quizAnswers = [];
            this.quizMode = true;
        },
        answerQuiz(known) {
            const currentWord = this.quizWords[this.quizIndex];
            this.quizAnswers.push({ ...currentWord, known });
            if (known) this.knownCount++;
            if (known && this.settings.autoArchiveKnown) {
                this.archiveWord(currentWord.word);
            }
            if (this.quizIndex + 1 >= this.quizWords.length) {
                this.lastWrongWords = this.quizAnswers.filter((answer) => !answer.known);
                this.quizFinished = true;
            } else {
                this.quizIndex++;
                this.quizRevealed = false;
            }
        }
    }
}).mount('#app');
