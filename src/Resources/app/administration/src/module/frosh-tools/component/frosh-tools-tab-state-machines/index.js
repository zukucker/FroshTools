import './style.scss';
import template from './template.html.twig';
import mermaid from 'mermaid';

const {
    Component,
    Mixin,
    Data: { Criteria },
} = Shopware;

const ACTION_CATEGORIES = {
    payment: [
        'pay',
        'paid_partially',
        'refund',
        'refund_partially',
        'authorize',
        'chargeback',
        'do_pay',
    ],
    processing: ['process', 'process_unconfirmed', 'complete'],
    shipping: ['ship', 'ship_partially', 'retour', 'retour_partially'],
    customer: ['remind', 'reopen'],
    error: ['fail', 'cancel'],
};

const SUCCESS_KEYWORDS = [
    'paid',
    'complete',
    'shipped',
    'refunded',
    'returned',
    'authorized',
];
const ERROR_KEYWORDS = [
    'fail',
    'cancel',
    'cancelled',
    'canceled',
    'chargeback',
    'error',
];
const WARNING_KEYWORDS = [
    'partial',
    'remind',
    'reminded',
    'unconfirmed',
    'process',
];

function getActionCategory(actionName) {
    for (const [cat, actions] of Object.entries(ACTION_CATEGORIES)) {
        if (actions.includes(actionName)) {
            return cat;
        }
    }
    return 'other';
}

function getStateColor(state, transitions, initialStateId) {
    const outgoing = transitions.filter(
        (t) => t.fromStateId === state.id && t.actionName !== 'reopen'
    );
    if (outgoing.length === 0) {
        return 'muted';
    }

    const name = (state.technicalName || '').toLowerCase();

    if (SUCCESS_KEYWORDS.some((k) => name.includes(k))) {
        return 'success';
    }
    if (ERROR_KEYWORDS.some((k) => name.includes(k))) {
        return 'danger';
    }
    if (WARNING_KEYWORDS.some((k) => name.includes(k))) {
        return 'warning';
    }
    if (state.id === initialStateId) {
        return 'accent';
    }
    return 'info';
}

Component.register('frosh-tools-tab-state-machines', {
    template,

    inject: ['repositoryFactory'],

    mixins: [Mixin.getByName('notification')],

    data() {
        return {
            selectedStateMachine: null,
            stateMachineOptions: [],
            stateMachine: null,
            selectedStateId: null,
            viewMode: '1hop',
            stateSearch: '',
            filterCategory: null,
            filterType: null,
            filterTransition: '',
            isLoading: false,
            renderCount: 0,
            zoom: 1,
            panX: 0,
            panY: 0,
            isPanning: false,
            panStartX: 0,
            panStartY: 0,
            tooltipVisible: false,
            tooltipText: '',
            tooltipX: 0,
            tooltipY: 0,
        };
    },

    computed: {
        stateMachineRepository() {
            return this.repositoryFactory.create('state_machine');
        },

        states() {
            return this.stateMachine?.states || [];
        },

        transitions() {
            return this.stateMachine?.transitions || [];
        },

        initialStateId() {
            return this.stateMachine?.initialStateId || null;
        },

        filteredStates() {
            let result = this.states;

            if (this.stateSearch) {
                const q = this.stateSearch.toLowerCase();
                result = result.filter(
                    (s) =>
                        (s.name || '').toLowerCase().includes(q) ||
                        (s.technicalName || '').toLowerCase().includes(q)
                );
            }

            if (this.filterType === 'initial') {
                result = result.filter((s) => s.id === this.initialStateId);
            } else if (this.filterType === 'terminal') {
                result = result.filter((s) => this.isTerminalState(s));
            }

            if (this.filterCategory) {
                const actionNames = (
                    ACTION_CATEGORIES[this.filterCategory] || []
                );
                const matchingStateIds = new Set();
                this.transitions.forEach((t) => {
                    if (actionNames.includes(t.actionName)) {
                        matchingStateIds.add(t.fromStateId);
                        matchingStateIds.add(t.toStateId);
                    }
                });
                result = result.filter((s) => matchingStateIds.has(s.id));
            }

            return result;
        },

        selectedState() {
            if (!this.selectedStateId) {
                return null;
            }
            return this.states.find((s) => s.id === this.selectedStateId) || null;
        },

        incomingTransitions() {
            if (!this.selectedStateId) {
                return [];
            }
            return this.transitions
                .filter((t) => t.toStateId === this.selectedStateId)
                .map((t) => ({
                    ...t,
                    fromState: this.states.find((s) => s.id === t.fromStateId),
                }));
        },

        outgoingTransitions() {
            if (!this.selectedStateId) {
                return [];
            }
            return this.transitions
                .filter((t) => t.fromStateId === this.selectedStateId)
                .map((t) => ({
                    ...t,
                    toState: this.states.find((s) => s.id === t.toStateId),
                }));
        },

        stateActions() {
            return [...new Set(this.outgoingTransitions.map((t) => t.actionName))];
        },

        actionGroups() {
            const groups = {};
            for (const t of this.transitions) {
                const cat = getActionCategory(t.actionName);
                if (!groups[cat]) {
                    groups[cat] = new Set();
                }
                groups[cat].add(t.actionName);
            }
            const result = {};
            for (const [cat, actions] of Object.entries(groups)) {
                result[cat] = [...actions].sort();
            }
            return result;
        },

        stateColorMap() {
            const map = {};
            for (const s of this.states) {
                map[s.id] = getStateColor(
                    s,
                    this.transitions,
                    this.initialStateId
                );
            }
            return map;
        },

        categoryOptions() {
            return [
                { value: null, label: this.$t('frosh-tools.tabs.state-machines.allCategories') },
                { value: 'payment', label: this.$t('frosh-tools.tabs.state-machines.categories.payment') },
                { value: 'processing', label: this.$t('frosh-tools.tabs.state-machines.categories.processing') },
                { value: 'shipping', label: this.$t('frosh-tools.tabs.state-machines.categories.shipping') },
                { value: 'customer', label: this.$t('frosh-tools.tabs.state-machines.categories.customer') },
                { value: 'error', label: this.$t('frosh-tools.tabs.state-machines.categories.error') },
                { value: 'other', label: this.$t('frosh-tools.tabs.state-machines.categories.other') },
            ];
        },

        typeOptions() {
            return [
                { value: null, label: this.$t('frosh-tools.tabs.state-machines.allTypes') },
                { value: 'initial', label: this.$t('frosh-tools.tabs.state-machines.initialState') },
                { value: 'terminal', label: this.$t('frosh-tools.tabs.state-machines.terminalState') },
            ];
        },

        filteredTransitions() {
            if (!this.filterTransition) {
                return this.transitions;
            }
            const q = this.filterTransition.toLowerCase();
            return this.transitions.filter((t) =>
                t.actionName.toLowerCase().includes(q)
            );
        },

        graphDiagram() {
            if (!this.stateMachine || !this.selectedStateId) {
                return '';
            }

            if (this.viewMode === '1hop') {
                return this.build1HopDiagram();
            }
            if (this.viewMode === 'tree') {
                return '';
            }
            return this.buildFullDiagram();
        },
    },

    watch: {
        graphDiagram() {
            this.$nextTick(() => {
                this.renderGraph();
            });
        },
    },

    created() {
        this.createdComponent();
    },

    methods: {
        async createdComponent() {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: 'basis',
                },
            });

            const criteria = new Criteria();
            criteria.addSorting(Criteria.sort('name', 'ASC'));

            const stateMachines = await this.stateMachineRepository.search(
                criteria,
                Shopware.Context.api
            );
            this.stateMachineOptions = stateMachines.map((sm) => ({
                value: sm.id,
                label: sm.name,
            }));

            this.isLoading = false;
        },

        async onStateMachineChange(stateMachineChangeId) {
            if (!stateMachineChangeId) {
                this.stateMachine = null;
                this.selectedStateId = null;
                return;
            }

            this.isLoading = true;

            const criteria = new Criteria([stateMachineChangeId]);
            criteria.addAssociation('states');
            criteria.addAssociation('transitions');

            this.stateMachine = await this.stateMachineRepository.get(
                stateMachineChangeId,
                Shopware.Context.api,
                criteria
            );

            if (this.stateMachine?.initialStateId) {
                this.selectedStateId = this.stateMachine.initialStateId;
            } else if (this.states.length > 0) {
                this.selectedStateId = this.states[0].id;
            }

            this.resetView();
            this.isLoading = false;
        },

        selectState(stateId) {
            this.selectedStateId = stateId;
        },

        isTerminalState(state) {
            const outgoing = this.transitions.filter(
                (t) => t.fromStateId === state.id && t.actionName !== 'reopen'
            );
            return outgoing.length === 0;
        },

        isInitialState(state) {
            return state.id === this.initialStateId;
        },

        getActionCategory(actionName) {
            return getActionCategory(actionName);
        },

        getStateColor(state) {
            return this.stateColorMap[state.id] || 'info';
        },

        getStateNameById(id) {
            const s = this.states.find((st) => st.id === id);
            return s ? s.name : id;
        },

        build1HopDiagram() {
            const selectedId = this.selectedStateId;
            const lines = ['flowchart LR'];

            const selectedState = this.states.find((s) => s.id === selectedId);
            if (!selectedState) {
                return '';
            }

            const incoming = this.transitions.filter(
                (t) => t.toStateId === selectedId
            );
            const outgoing = this.transitions.filter(
                (t) => t.fromStateId === selectedId
            );

            const nodeIds = new Set([selectedId]);
            incoming.forEach((t) => nodeIds.add(t.fromStateId));
            outgoing.forEach((t) => nodeIds.add(t.toStateId));

            for (const id of nodeIds) {
                const st = this.states.find((s) => s.id === id);
                if (!st) {
                    continue;
                }
                const color = this.getStateColor(st);
                const name = (st.name || '').replace(/"/g, "'");
                if (id === selectedId) {
                    lines.push(
                        `    ${id}["${name}"]:::selected`
                    );
                } else {
                    lines.push(
                        `    ${id}["${name}"]:::${color}`
                    );
                }
            }

            for (const t of this.filteredTransitions) {
                if (nodeIds.has(t.fromStateId) && nodeIds.has(t.toStateId)) {
                    const action = t.actionName.replace(/"/g, "'");
                    lines.push(
                        `    ${t.fromStateId} -->|"${action}"| ${t.toStateId}`
                    );
                }
            }

            lines.push('');
            lines.push('    classDef selected fill:#2563eb,color:#fff,stroke:#1d4ed8,stroke-width:2px');
            lines.push('    classDef info fill:#e0ecff,color:#2563eb,stroke:#2563eb');
            lines.push('    classDef success fill:#dcfce7,color:#16a34a,stroke:#16a34a');
            lines.push('    classDef warning fill:#fef3c7,color:#d97706,stroke:#d97706');
            lines.push('    classDef danger fill:#fee2e2,color:#dc2626,stroke:#dc2626');
            lines.push('    classDef muted fill:#e2e8f0,color:#475569,stroke:#475569');

            return lines.join('\n');
        },

        buildFullDiagram() {
            const lines = ['flowchart TD'];

            const initStateId = this.initialStateId;

            if (initStateId) {
                lines.push('    __start__(( ))');
                lines.push(`    __start__ --> ${initStateId}`);
            }

            for (const st of this.states) {
                const color = this.getStateColor(st);
                const name = (st.name || '').replace(/"/g, "'");
                lines.push(`    ${st.id}["${name}"]:::${color}`);
            }

            for (const t of this.filteredTransitions) {
                const action = t.actionName.replace(/"/g, "'");
                lines.push(
                    `    ${t.fromStateId} -->|"${action}"| ${t.toStateId}`
                );
            }

            lines.push('');
            lines.push('    classDef info fill:#e0ecff,color:#2563eb,stroke:#2563eb');
            lines.push('    classDef success fill:#dcfce7,color:#16a34a,stroke:#16a34a');
            lines.push('    classDef warning fill:#fef3c7,color:#d97706,stroke:#d97706');
            lines.push('    classDef danger fill:#fee2e2,color:#dc2626,stroke:#dc2626');
            lines.push('    classDef muted fill:#e2e8f0,color:#475569,stroke:#475569');
            lines.push('    classDef accent fill:#e0ecff,color:#2563eb,stroke:#2563eb');

            return lines.join('\n');
        },

        buildTreeNodes(stateId, depth = 0, visited = new Set()) {
            if (depth > 3 || visited.has(stateId)) {
                return null;
            }
            visited.add(stateId);

            const state = this.states.find((s) => s.id === stateId);
            if (!state) {
                return null;
            }

            const outgoing = this.transitions.filter(
                (t) => t.fromStateId === stateId
            );

            return {
                state,
                color: this.getStateColor(state),
                children: outgoing.map((t) => ({
                    transition: t,
                    child: this.buildTreeNodes(t.toStateId, depth + 1, new Set(visited)),
                })),
            };
        },

        async renderGraph() {
            if (this.viewMode === 'tree') {
                return;
            }

            const container = this.$refs.graphContainer;
            if (!container) {
                return;
            }

            const mermaidEl = this.$refs.mermaidSource;
            if (!mermaidEl) {
                return;
            }

            if (!this.graphDiagram) {
                container.innerHTML = '';
                return;
            }

            this.renderCount += 1;
            try {
                const { svg } = await mermaid.render(
                    `mermaid-diagram-${this.renderCount}`,
                    this.graphDiagram
                );
                mermaidEl.innerHTML = svg;

                this.$nextTick(() => {
                    this.bindGraphEvents();
                    this.applyTransform();
                });
            } catch (e) {
                mermaidEl.innerHTML = '';
            }
        },

        bindGraphEvents() {
            const wrapper = this.$refs.graphContainer;
            if (!wrapper) {
                return;
            }

            const svg = wrapper.querySelector('svg');
            if (!svg) {
                return;
            }

            svg.style.cursor = 'grab';

            const nodeEls = svg.querySelectorAll('.node');
            nodeEls.forEach((nodeEl) => {
                const id = nodeEl.id;
                if (!id) {
                    return;
                }

                nodeEl.style.cursor = 'pointer';

                nodeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const match = this.states.find((s) => s.id === id);
                    if (match) {
                        this.selectState(id);
                    }
                });

                nodeEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this.centerOnNode(nodeEl);
                });

                nodeEl.addEventListener('mouseenter', (e) => {
                    const state = this.states.find((s) => s.id === id);
                    if (!state) {
                        return;
                    }
                    const lines = [
                        state.name,
                        state.technicalName ? `technical: ${state.technicalName}` : '',
                        `id: ${state.id}`,
                    ].filter(Boolean);
                    this.showTooltip(lines.join('\n'), e.clientX, e.clientY);
                });

                nodeEl.addEventListener('mousemove', (e) => {
                    this.moveTooltip(e.clientX, e.clientY);
                });

                nodeEl.addEventListener('mouseleave', () => {
                    this.hideTooltip();
                });
            });

            const edgeEls = svg.querySelectorAll('.edge');
            edgeEls.forEach((edgeEl) => {
                edgeEl.style.cursor = 'pointer';

                edgeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const paths = edgeEl.querySelectorAll('path');
                    const labels = edgeEl.querySelectorAll('.edgeLabel text');
                    let actionName = '';
                    if (labels.length > 0) {
                        actionName = labels[0].textContent.trim();
                    }
                    if (actionName) {
                        this.filterTransition = actionName;
                    }
                });
            });
        },

        centerOnNode(nodeEl) {
            const wrapper = this.$refs.graphContainer;
            if (!wrapper || !nodeEl) {
                return;
            }

            const svg = wrapper.querySelector('svg');
            if (!svg) {
                return;
            }

            const wrapperRect = wrapper.getBoundingClientRect();
            const nodeRect = nodeEl.getBoundingClientRect();

            const nodeCenterX =
                nodeRect.left + nodeRect.width / 2 - svg.getBoundingClientRect().left;
            const nodeCenterY =
                nodeRect.top + nodeRect.height / 2 - svg.getBoundingClientRect().top;

            const containerCenterX = wrapperRect.width / 2;
            const containerCenterY = wrapperRect.height / 2;

            this.panX = (containerCenterX - nodeCenterX * this.zoom) / this.zoom;
            this.panY = (containerCenterY - nodeCenterY * this.zoom) / this.zoom;

            this.applyTransform();
        },

        showTooltip(text, x, y) {
            this.tooltipText = text;
            this.tooltipX = x + 12;
            this.tooltipY = y + 12;
            this.tooltipVisible = true;
        },

        moveTooltip(x, y) {
            this.tooltipX = x + 12;
            this.tooltipY = y + 12;
        },

        hideTooltip() {
            this.tooltipVisible = false;
        },

        onWheel(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Math.min(3, Math.max(0.2, this.zoom + delta));
            this.zoom = newZoom;
            this.applyTransform();
        },

        onMouseDown(e) {
            if (e.button !== 0) {
                return;
            }
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX * this.zoom;
            this.panStartY = e.clientY - this.panY * this.zoom;

            const wrapper = this.$refs.graphContainer;
            if (wrapper) {
                const svg = wrapper.querySelector('svg');
                if (svg) {
                    svg.style.cursor = 'grabbing';
                }
            }
        },

        onMouseMove(e) {
            if (!this.isPanning) {
                return;
            }
            this.panX = (e.clientX - this.panStartX) / this.zoom;
            this.panY = (e.clientY - this.panStartY) / this.zoom;
            this.applyTransform();
        },

        onMouseUp() {
            this.isPanning = false;
            const wrapper = this.$refs.graphContainer;
            if (wrapper) {
                const svg = wrapper.querySelector('svg');
                if (svg) {
                    svg.style.cursor = 'grab';
                }
            }
        },

        applyTransform() {
            const wrapper = this.$refs.graphContainer;
            if (!wrapper) {
                return;
            }
            const inner = wrapper.querySelector('.sm-graph-inner');
            if (!inner) {
                return;
            }
            inner.style.transform = `scale(${this.zoom}) translate(${this.panX}px, ${this.panY}px)`;
        },

        zoomIn() {
            this.zoom = Math.min(3, this.zoom + 0.2);
            this.applyTransform();
        },

        zoomOut() {
            this.zoom = Math.max(0.2, this.zoom - 0.2);
            this.applyTransform();
        },

        resetView() {
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.applyTransform();
        },
    },
});
