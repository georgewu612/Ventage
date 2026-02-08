"""
Data loader for Ventage
Handles inserting data into Supabase using service role
"""
import logging
from typing import Any

from supabase import Client, create_client

from python.config.settings import settings

logger = logging.getLogger(__name__)


class DataLoader:
    """Data loader for Supabase"""
    
    def __init__(self):
        self.client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
    
    def insert_records(self, table: str, records: list[dict[str, Any]]) -> int:
        """
        Insert multiple records into a table
        
        Args:
            table: Table name
            records: List of records as dictionaries
            
        Returns:
            Number of records inserted
        """
        try:
            # Convert Pydantic models to JSON-compatible dicts
            data = []
            for r in records:
                if isinstance(r, dict):
                    item = r.copy()
                else:
                    # Use model_dump with mode='json' to handle UUID, Decimal, etc.
                    item = r.model_dump(mode='json', exclude_none=True)
                
                # Remove id field - let database generate it
                if 'id' in item:
                    del item['id']
                    
                data.append(item)
            
            response = self.client.table(table).insert(data).execute()
            inserted_count = len(response.data) if response.data else 0
            
            logger.info(f"Inserted {inserted_count} records into {table}")
            return inserted_count
            
        except Exception as e:
            logger.error(f"Error inserting into {table}: {e}")
            raise
    
    def clear_table(self, table: str) -> int:
        """
        Clear all records from a table (for testing)
        
        Args:
            table: Table name
            
        Returns:
            Number of records deleted
        """
        try:
            # Delete all records
            response = self.client.table(table).delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
            deleted_count = len(response.data) if response.data else 0
            
            logger.info(f"Cleared {deleted_count} records from {table}")
            return deleted_count
            
        except Exception as e:
            logger.error(f"Error clearing {table}: {e}")
            raise
