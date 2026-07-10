import { projects, phases, members, requirements, issues, tests, risks, tasks, documents, meetings, sprints, interfaces, infraAssets, firewallRequests, procurementItems, boards, testCycles, todos } from '@/db/schema';
import { RISK_TRANSFORM, DOCUMENTS_TRANSFORM, GUARD_TASK_CHILDREN, GUARD_PHASE_IN_USE, type CrudConfig } from './crud';
export const CONFIGS: Record<string, CrudConfig> = {
  projects: { table: projects, resource: 'project', scope: 'org', codePrefix: 'PRJ', fields: ['name','client','startDate','endDate','status','pmUserId'], required: ['name'] },
  phases: { table: phases, resource: 'phase', scope: 'project', codePrefix: 'PH', orderAsc: true, fields: ['name','color','sortOrder','status'], required: ['name'], guardDelete: GUARD_PHASE_IN_USE },
  members: { table: members, resource: 'member', scope: 'org', codePrefix: 'MEM', fields: ['name','company','position','role','email','phone'], required: ['name'] },
  requirements: { table: requirements, resource: 'requirement', scope: 'project', codePrefix: 'REQ', fields: ['title','description','category','priority','status','assignee'], required: ['title'] },
  tests: { table: tests, resource: 'test', scope: 'project', codePrefix: 'TC', orderAsc: true, fields: ['title','reqCode','cycle','type','priority','steps','expected','assignee','reporter','dueDate','progress','status','result'], required: ['title'] },
  issues: { table: issues, resource: 'issue', scope: 'project', codePrefix: 'ISS', fields: ['title','description','type','priority','status','assignee','dueDate','labels','storyPoints','sprintId','epic','reqCode','estimateHours','spentHours'], required: ['title'], journal: true },
  risks: { table: risks, resource: 'risk', scope: 'project', codePrefix: 'RSK', fields: ['title','description','probability','impact','status','owner'], required: ['title'], transform: RISK_TRANSFORM },
  tasks: { table: tasks, resource: 'task', scope: 'project', codePrefix: 'WBS', orderAsc: true, fields: ['name','phase','assignee','status','startDate','endDate','progress','reqCode','predecessor','parentId','plannedHours','actualHours','baselineStart','baselineEnd'], required: ['name'], guardDelete: GUARD_TASK_CHILDREN },
  documents: { table: documents, resource: 'document', scope: 'project', codePrefix: 'DOC', fields: ['title','type','version','status','author','approver'], required: ['title'], transform: DOCUMENTS_TRANSFORM, approveOn: { field: 'status', values: ['approved','rejected'] } },
  meetings: { table: meetings, resource: 'meeting', scope: 'project', codePrefix: 'MTG', fields: ['title','meetingDate','location','attendees','agenda','decisions'], required: ['title'] },
  sprints: { table: sprints, resource: 'sprint', scope: 'project', codePrefix: 'SPR', fields: ['name','goal','status','startDate','endDate'], required: ['name'] },
  testCycles: { table: testCycles, resource: 'testCycle', scope: 'project', codePrefix: 'CYC', fields: ['name','goal','status','startDate','endDate'], required: ['name'] },
  todos: { table: todos, resource: 'todo', scope: 'user', codePrefix: 'TD', fields: ['title','note','priority','status','dueDate'], required: ['title'] },
  interfaces: { table: interfaces, resource: 'interface', scope: 'project', codePrefix: 'IF', fields: ['name','srcSystem','dstSystem','protocol','format','cycle','status'], required: ['name'] },
  infra: { table: infraAssets, resource: 'infra', scope: 'project', codePrefix: 'AST', fields: ['name','category','model','location','ipAddress','owner','hostname','os','cpu','memory','rack','serialNo','status'], required: ['name'] },
  firewall: { table: firewallRequests, resource: 'firewall', scope: 'project', codePrefix: 'FW', fields: ['title','srcIp','dstIp','port','protocol','reason','status'], required: ['title'] },
  procurement: { table: procurementItems, resource: 'procurement', scope: 'project', codePrefix: 'PO', fields: ['item','category','qty','unitPrice','vendor','status'], required: ['item'] },
  boards: { table: boards, resource: 'board', scope: 'org', codePrefix: 'BRD', fields: ['title','category','author','content'], required: ['title'] },
};
