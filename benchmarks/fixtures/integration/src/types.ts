export type TicketSeverity = 'low' | 'medium' | 'high';

export type Ticket = {
  id: string;
  owner: string;
  severity: TicketSeverity;
  customerFacing: boolean;
  tags: string[];
};

export type OwnerLoad = {
  owner: string;
  load: number;
  ticketIds: string[];
};

export type DashboardSummary = {
  totalTickets: number;
  customerFacingTickets: number;
  bySeverity: Record<TicketSeverity, number>;
  topOwners: OwnerLoad[];
  highlightedTicketIds: string[];
};
