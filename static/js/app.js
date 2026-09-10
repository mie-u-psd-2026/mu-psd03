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
            sidebarOpen: false,
            menuOpen: false,
            settings: { level: 'intermediate' }
        };
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
            } catch (e) {
                this.error = e.message || '単語帳の作成に失敗しました。';
            } finally {
                this.isExtracting = false;
            }
        },
        toggleWord(word) {
            this.revealed[word] = !this.revealed[word];
        },
        startQuiz() {
            // 単語帳は無制限だが、クイズは1回ランダム10問固定
            this.quizWords = [...this.current.words].sort(() => Math.random() - 0.5).slice(0, 10);
            this.quizIndex = 0;
            this.quizRevealed = false;
            this.quizFinished = false;
            this.knownCount = 0;
            this.quizMode = true;
        },
        answerQuiz(known) {
            if (known) this.knownCount++;
            if (this.quizIndex + 1 >= this.quizWords.length) {
                this.quizFinished = true;
            } else {
                this.quizIndex++;
                this.quizRevealed = false;
            }
        }
    }
}).mount('#app');
