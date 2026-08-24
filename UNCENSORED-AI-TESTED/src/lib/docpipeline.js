'use client';

import { createTask, setStepState, completeTask, failTask } from './tasks';
import { put } from './localdb';

export async function writeDocumentSections(docArtifact, { notify } = {}) {
    const taskId = createTask({
        title: `Writing "${docArtifact.title}"`,
        steps: docArtifact.sections.map((s) => s.title),
    });

    let working = [...docArtifact.sections];
    let failure = null;

    for (let i = 0; i < working.length; i++) {
        if (working[i].content && working[i].content.length > 200) {
            setStepState(taskId, working[i].title, 'done');
            continue;
        }
        setStepState(taskId, working[i].title, 'active');

        let attempt = 0;
        while (attempt < 2) {
            try {
                const res = await fetch('/api/document/section', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-access-key': (typeof localStorage !== 'undefined' ? localStorage.getItem('wb_access_key') || '' : '') },
                    body: JSON.stringify({
                        title: docArtifact.title,
                        description: docArtifact.description,
                        sections: working.map((s) => ({ ...s, content: s.content || '' })),
                        index: i,
                    }),
                });
                if (!res.ok) throw new Error(await res.text());
                const data = await res.json();
                if (!data.content || data.content.length < 200) throw new Error('Section too short');
                working = working.map((s, j) => (j === i ? { ...s, content: data.content, status: 'written', generation: undefined } : s));
                setStepState(taskId, working[i].title, 'done');
                attempt = 2;
            } catch (e) {
                attempt += 1;
                if (attempt >= 2) {
                    setStepState(taskId, working[i].title, 'failed');
                    failure = `Section ${i + 1} (${working[i].title}) failed twice.`;
                }
            }
        }

        await put('artifacts', {
            id: docArtifact.id,
            kind: 'document',
            title: docArtifact.title,
            description: docArtifact.description,
            prompt: docArtifact.prompt,
            sections: working,
            createdAt: docArtifact.createdAt || Date.now(),
            updatedAt: Date.now(),
        });
        notify?.(`Progress: ${i + 1}/${working.length} sections`, 'info', docArtifact.id);
    }

    const finished = !failure;
    if (finished) completeTask(taskId);
    else failTask(taskId, failure);

    return { sections: working, failure };
}
