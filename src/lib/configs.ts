import { projects, phases, members, requirements, issues, risks, tasks, documents, meetings, sprints, interfaces, infraAssets, firewallRequests, procurementItems, boards } from '@/db/schema';
import { RISK_TRANSFORM, type CrudConfig } from './crud';
export const CONFIGS: Record<string, CrudConfig> = {
  projects: { table: projects, resource: 'project', scope: 'org', codePrefix: 'PRJ', fields: ['name','client','startDate','endDate','status','pmUserId'], required: ['name'] },
  phases: { table: phases, resource: 'phase', scope: 'project', codePrefix: 'PH', fields: ['name','color','sortOrder','status'], required: ['name'] },
  members: { table: members, resource: 'member', scope: 'org', codePrefix: 'MEM', fields: ['name','company','position','role','email','phone'], required: ['name'] },
  requirements: { table: requirements, resource: 'requirement', scope: 'project', codePrefix: 'REQ', fields: ['title','description','category','priority','status','assignee'], required: ['title'] },
  issues: { table: issues, resource: 'issue', scope: 'project', codePrefix: 'ISS', fields: ['title','description','type','priority','status','assignee','dueDate','labels','storyPoints','sprintId','epic'], required: ['title'] },
  risks: { table: risks, resource: 'risk', scope: 'project', codePrefix: 'RSK', fields: ['title','description','probability','impact','status','owner'], required: ['title'], transform: RISK_TRANSFORM },
  tasks: { table: tasks, resource: 'task', scope: 'project', codePrefix: 'WBS', fields: ['name','phase','assignee','status','startDate','endDate','progress'], required: ['name'] },
  documents: { table: documents, resource: 'document', scope: 'project', codePrefix: 'DOC', fields: ['title','type','version','status','author','approver'], required: ['title'] },
  meetings: { table: meetings, resource: 'meeting', scope: 'project', codePrefix: 'MTG', fields: ['title','meetingDate','location','attendees','agenda','decisions'], required: ['title'] },
  sprints: { table: sprints, resource: 'sprint', scope: 'project', codePrefix: 'SPR', fields: ['name','goal','status','startDate','endDate'], required: ['name'] },
  interfaces: { table: interfaces, resource: 'interface', scope: 'project', codePrefix: 'IF', fields: ['name','srcSystem','dstSystem','protocol','format','cycle','status'], required: ['name'] },
  infra: { table: infraAssets, resource: 'infra', scope: 'project', codePrefix: 'AST', fields: ['name','category','model','location','ipAddress','owner','status'], required: ['name'] },
  firewall: { table: firewallRequests, resource: 'firewall', scope: 'project', codePrefix: 'FW', fields: ['title','srcIp','dstIp','port','protocol','reason','status'], required: ['title'] },
  procurement: { table: procurementItems, resource: 'procurement', scope: 'project', codePrefix: 'PO', fields: ['item','category','qty','unitPrice','vendor','status'], required: ['item'] },
  boards: { table: boards, resource: 'board', scope: 'org', codePrefix: 'BRD', fields: ['title','category','author','content'], required: ['title'] },
};
