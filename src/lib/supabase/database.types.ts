export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
type Timestamps = { created_at: string; updated_at: string };
// M0 data access is read-only. Update these types alongside migrations.
export type Database = {
  public: {
    Tables: {
      profiles: Table<
        Timestamps & {
          id: string;
          display_name: string;
          deleted_at: string | null;
        }
      >;
      roles: Table<Timestamps & { id: string; name: string }>;
      user_roles: Table<
        Timestamps & { id: string; user_id: string; role: string }
      >;
      audit_logs: Table<{
        id: string;
        actor_id: string | null;
        action: string;
        entity: string;
        entity_id: string;
        old_value: Json;
        new_value: Json;
        created_at: string;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      crm_query: { Args: { p_input: Json }; Returns: Json };
      crm_mutate: { Args: { p_input: Json }; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
