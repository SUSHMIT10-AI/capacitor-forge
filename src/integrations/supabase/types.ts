export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      build_configs: {
        Row: {
          admob_app_id: string | null
          admob_app_open_id: string | null
          admob_banner_id: string | null
          admob_interstitial_id: string | null
          admob_rewarded_id: string | null
          admob_rewarded_interstitial_id: string | null
          admob_test_mode: boolean
          allow_cleartext: boolean
          allow_external_links: boolean
          allow_zoom: boolean
          app_name: string
          block_screenshots: boolean
          build_type: string
          cache_enabled: boolean
          codemagic_build_id: string | null
          created_at: string
          custom_css: string | null
          custom_html: string | null
          custom_js: string | null
          dark_mode_force: boolean
          detected_plugins: Json | null
          download_url: string | null
          enable_admob: boolean
          enable_billing: boolean
          enable_biometric: boolean
          enable_bluetooth: boolean
          enable_calendar: boolean
          enable_camera: boolean
          enable_capacitor: boolean
          enable_clipboard: boolean
          enable_contacts: boolean
          enable_file_download: boolean
          enable_file_upload: boolean
          enable_geolocation: boolean
          enable_location: boolean
          enable_microphone: boolean
          enable_native_splash: boolean
          enable_nfc: boolean
          enable_offline_page: boolean
          enable_phone_state: boolean
          enable_pull_to_refresh: boolean
          enable_push_notifications: boolean
          enable_share: boolean
          enable_sms: boolean
          enable_storage: boolean
          enable_vibrate: boolean
          error_message: string | null
          fullscreen_mode: boolean
          hide_status_bar: boolean
          icon_path: string | null
          id: string
          keep_screen_on: boolean
          mode: string
          nav_color: string | null
          orientation: string
          output_aab_path: string | null
          output_apk_path: string | null
          package_name: string
          project_zip_path: string | null
          signing_key_id: string | null
          splash_color: string | null
          status: string
          swipe_back_navigation: boolean
          sync_log: string | null
          theme_color: string | null
          updated_at: string
          url: string | null
          user_agent_override: string | null
          user_id: string
          version_code: number
          version_name: string
        }
        Insert: {
          admob_app_id?: string | null
          admob_app_open_id?: string | null
          admob_banner_id?: string | null
          admob_interstitial_id?: string | null
          admob_rewarded_id?: string | null
          admob_rewarded_interstitial_id?: string | null
          admob_test_mode?: boolean
          allow_cleartext?: boolean
          allow_external_links?: boolean
          allow_zoom?: boolean
          app_name: string
          block_screenshots?: boolean
          build_type?: string
          cache_enabled?: boolean
          codemagic_build_id?: string | null
          created_at?: string
          custom_css?: string | null
          custom_html?: string | null
          custom_js?: string | null
          dark_mode_force?: boolean
          detected_plugins?: Json | null
          download_url?: string | null
          enable_admob?: boolean
          enable_billing?: boolean
          enable_biometric?: boolean
          enable_bluetooth?: boolean
          enable_calendar?: boolean
          enable_camera?: boolean
          enable_capacitor?: boolean
          enable_clipboard?: boolean
          enable_contacts?: boolean
          enable_file_download?: boolean
          enable_file_upload?: boolean
          enable_geolocation?: boolean
          enable_location?: boolean
          enable_microphone?: boolean
          enable_native_splash?: boolean
          enable_nfc?: boolean
          enable_offline_page?: boolean
          enable_phone_state?: boolean
          enable_pull_to_refresh?: boolean
          enable_push_notifications?: boolean
          enable_share?: boolean
          enable_sms?: boolean
          enable_storage?: boolean
          enable_vibrate?: boolean
          error_message?: string | null
          fullscreen_mode?: boolean
          hide_status_bar?: boolean
          icon_path?: string | null
          id?: string
          keep_screen_on?: boolean
          mode?: string
          nav_color?: string | null
          orientation?: string
          output_aab_path?: string | null
          output_apk_path?: string | null
          package_name?: string
          project_zip_path?: string | null
          signing_key_id?: string | null
          splash_color?: string | null
          status?: string
          swipe_back_navigation?: boolean
          sync_log?: string | null
          theme_color?: string | null
          updated_at?: string
          url?: string | null
          user_agent_override?: string | null
          user_id: string
          version_code?: number
          version_name?: string
        }
        Update: {
          admob_app_id?: string | null
          admob_app_open_id?: string | null
          admob_banner_id?: string | null
          admob_interstitial_id?: string | null
          admob_rewarded_id?: string | null
          admob_rewarded_interstitial_id?: string | null
          admob_test_mode?: boolean
          allow_cleartext?: boolean
          allow_external_links?: boolean
          allow_zoom?: boolean
          app_name?: string
          block_screenshots?: boolean
          build_type?: string
          cache_enabled?: boolean
          codemagic_build_id?: string | null
          created_at?: string
          custom_css?: string | null
          custom_html?: string | null
          custom_js?: string | null
          dark_mode_force?: boolean
          detected_plugins?: Json | null
          download_url?: string | null
          enable_admob?: boolean
          enable_billing?: boolean
          enable_biometric?: boolean
          enable_bluetooth?: boolean
          enable_calendar?: boolean
          enable_camera?: boolean
          enable_capacitor?: boolean
          enable_clipboard?: boolean
          enable_contacts?: boolean
          enable_file_download?: boolean
          enable_file_upload?: boolean
          enable_geolocation?: boolean
          enable_location?: boolean
          enable_microphone?: boolean
          enable_native_splash?: boolean
          enable_nfc?: boolean
          enable_offline_page?: boolean
          enable_phone_state?: boolean
          enable_pull_to_refresh?: boolean
          enable_push_notifications?: boolean
          enable_share?: boolean
          enable_sms?: boolean
          enable_storage?: boolean
          enable_vibrate?: boolean
          error_message?: string | null
          fullscreen_mode?: boolean
          hide_status_bar?: boolean
          icon_path?: string | null
          id?: string
          keep_screen_on?: boolean
          mode?: string
          nav_color?: string | null
          orientation?: string
          output_aab_path?: string | null
          output_apk_path?: string | null
          package_name?: string
          project_zip_path?: string | null
          signing_key_id?: string | null
          splash_color?: string | null
          status?: string
          swipe_back_navigation?: boolean
          sync_log?: string | null
          theme_color?: string | null
          updated_at?: string
          url?: string | null
          user_agent_override?: string | null
          user_id?: string
          version_code?: number
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_configs_signing_key_id_fkey"
            columns: ["signing_key_id"]
            isOneToOne: false
            referencedRelation: "signing_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      conversions: {
        Row: {
          created_at: string
          error_message: string | null
          file_name: string
          file_size: number
          id: string
          output_path: string | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_name: string
          file_size: number
          id?: string
          output_path?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_size?: number
          id?: string
          output_path?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      play_purchases: {
        Row: {
          acknowledged: boolean
          created_at: string
          expiry_time_ms: number | null
          id: string
          is_subscription: boolean
          order_id: string | null
          package_name: string
          product_id: string
          purchase_state: number | null
          purchase_token: string
          raw: Json | null
          updated_at: string
          user_id: string
          verified_at: string
        }
        Insert: {
          acknowledged?: boolean
          created_at?: string
          expiry_time_ms?: number | null
          id?: string
          is_subscription?: boolean
          order_id?: string | null
          package_name: string
          product_id: string
          purchase_state?: number | null
          purchase_token: string
          raw?: Json | null
          updated_at?: string
          user_id: string
          verified_at?: string
        }
        Update: {
          acknowledged?: boolean
          created_at?: string
          expiry_time_ms?: number | null
          id?: string
          is_subscription?: boolean
          order_id?: string | null
          package_name?: string
          product_id?: string
          purchase_state?: number | null
          purchase_token?: string
          raw?: Json | null
          updated_at?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      signing_keys: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          key_alias: string
          key_password: string
          keystore_path: string | null
          name: string
          store_password: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          key_alias: string
          key_password: string
          keystore_path?: string | null
          name?: string
          store_password: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          key_alias?: string
          key_password?: string
          keystore_path?: string | null
          name?: string
          store_password?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
