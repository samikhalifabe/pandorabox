"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import axios from "axios"
import { sendWhatsAppMessage } from "@/services/messageService"
import type { Database } from "@/types/supabase"
import { useAuth } from "@/hooks/useAuth" // To get user ID

// Define types locally for now, to be centralized later
type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"]
interface AppMessage {
  id: string
  from: string
  to: string
  body: string
  timestamp: number
  isFromMe: boolean
  chatName: string
  chatId: string
  conversation_id?: string
  vehicle?: Vehicle | null
  message_id?: string
}
interface ChatGroup {
  // For context on selected chat
  id: string // Conversation UUID
  chatId: string
  chatName: string
  phoneNumber: string
  vehicle?: Vehicle | null
}

interface UseMessagesOptions {
  autoRefresh?: boolean
  refreshInterval?: number
}

export const useMessages = (
  selectedConversation: ChatGroup | null | undefined,
  onMessageSentOrReceived: (newMessage: AppMessage, conversationId: string) => void, // Callback to update global conversations
  options: UseMessagesOptions = { autoRefresh: false, refreshInterval: 10000 }, // Changed autoRefresh to false
) => {
  const { user } = useAuth()
  const [messagesForSelectedChat, setMessagesForSelectedChat] = useState<AppMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false)
  const [sendingMessage, setSendingMessage] = useState<boolean>(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchMessagesForChat = useCallback(
    async (conversationUUID: string) => {
      if (!conversationUUID || isRefreshing) {
        return
      }

      setIsRefreshing(true)
      setLoadingMessages(true)
      setSendError(null)

      try {
        const response = await axios.get(`http://31.97.69.92:3001/api/conversations/${conversationUUID}`)
        if (response.data && response.data.messages && Array.isArray(response.data.messages)) {
          const fetchedMessages: AppMessage[] = response.data.messages.map((msg: any) => ({
            id: msg.message_id || msg.id,
            from: msg.is_from_me ? "me" : response.data.phoneNumber + "@c.us",
            to: msg.is_from_me ? response.data.phoneNumber + "@c.us" : "me",
            body: msg.body,
            timestamp: new Date(msg.timestamp).getTime() / 1000,
            isFromMe: msg.is_from_me,
            chatName: response.data.vehicle?.brand + " " + response.data.vehicle?.model || "Chat sans nom",
            chatId: response.data.chatId || response.data.id,
            conversation_id: response.data.id,
            vehicle: response.data.vehicle,
          }))
          fetchedMessages.sort((a, b) => a.timestamp - b.timestamp)
          setMessagesForSelectedChat(fetchedMessages)
          
          // Si aucun message n'est trouvé, essayer de synchroniser automatiquement
          if (fetchedMessages.length === 0) {
            console.log(`Aucun message trouvé pour la conversation ${conversationUUID}, tentative de synchronisation...`)
            try {
              const syncResponse = await axios.post(`http://31.97.69.92:3001/api/whatsapp/sync-conversation/${conversationUUID}`)
              if (syncResponse.data.success && syncResponse.data.newMessagesSaved > 0) {
                console.log(`Synchronisation réussie: ${syncResponse.data.newMessagesSaved} messages récupérés`)
                // Recharger les messages après synchronisation
                const retryResponse = await axios.get(`http://31.97.69.92:3001/api/conversations/${conversationUUID}`)
                if (retryResponse.data && retryResponse.data.messages && Array.isArray(retryResponse.data.messages)) {
                  const syncedMessages: AppMessage[] = retryResponse.data.messages.map((msg: any) => ({
                    id: msg.message_id || msg.id,
                    from: msg.is_from_me ? "me" : retryResponse.data.phoneNumber + "@c.us",
                    to: msg.is_from_me ? retryResponse.data.phoneNumber + "@c.us" : "me",
                    body: msg.body,
                    timestamp: new Date(msg.timestamp).getTime() / 1000,
                    isFromMe: msg.is_from_me,
                    chatName: retryResponse.data.vehicle?.brand + " " + retryResponse.data.vehicle?.model || "Chat sans nom",
                    chatId: retryResponse.data.chatId || retryResponse.data.id,
                    conversation_id: retryResponse.data.id,
                    vehicle: retryResponse.data.vehicle,
                  }))
                  syncedMessages.sort((a, b) => a.timestamp - b.timestamp)
                  setMessagesForSelectedChat(syncedMessages)
                }
              }
            } catch (syncError) {
              console.warn("Erreur lors de la synchronisation automatique:", syncError)
              // Ne pas bloquer l'affichage si la synchronisation échoue
            }
          }
        } else {
          setMessagesForSelectedChat([])
        }
      } catch (err: any) {
        console.error(`Error fetching messages for chat ${conversationUUID}:`, err)
        setMessagesForSelectedChat([])
      } finally {
        setLoadingMessages(false)
        setIsRefreshing(false)
      }
    },
    [], // Removed isRefreshing from dependency array
  )

  // Effet pour gérer le chargement initial et la configuration de l'intervalle
  useEffect(() => {
    // Nettoyer l'intervalle précédent
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Charger les messages initialement si une conversation est sélectionnée
    if (selectedConversation?.id) {
      fetchMessagesForChat(selectedConversation.id)

      // Configurer un nouvel intervalle seulement si autoRefresh est activé
      if (options.autoRefresh) {
        intervalRef.current = setInterval(() => {
          if (selectedConversation?.id) {
            fetchMessagesForChat(selectedConversation.id)
          }
        }, options.refreshInterval)
      }
    }

    // Nettoyage à la désinstanciation
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [selectedConversation?.id, options.autoRefresh, options.refreshInterval, fetchMessagesForChat])

  const handleSendMessage = useCallback(
    async (text: string) => {
      console.log("handleSendMessage called with text:", text);
      console.log("selectedConversation:", selectedConversation);
      console.log("user:", user);
      console.log("text.trim():", text.trim());

      if (!selectedConversation) {
        console.log("Message sending aborted: No conversation selected.");
        setSendError("Aucune conversation sélectionnée.");
        return;
      }
      if (!text.trim()) {
        console.log("Message sending aborted: Message is empty.");
        // No need to set error for empty message, input is usually disabled or cleared
        return;
      }
      // Removed the check for !user here to allow sending without being logged in

      setSendingMessage(true)
      setSendError(null)

      try {
        const result = await sendWhatsAppMessage(
          selectedConversation.phoneNumber,
          text,
          selectedConversation.vehicle,
          user ? user.id : null, // Pass user.id if user exists, otherwise pass null
        )

        if (result.success) {
          // Message will be added via WebSocket, so no need to update state here
          // Optionally, call onMessageSentOrReceived if needed for other logic
          // if (result.conversationId) {
          //   // Create a temporary message object if needed for the callback
          //   const tempMessage: AppMessage = {
          //     id: result.messageId || Date.now().toString(),
          //     from: "me",
          //     to: selectedConversation.phoneNumber,
          //     body: text,
          //     timestamp: Date.now() / 1000,
          //     isFromMe: true,
          //     chatName: selectedConversation.chatName,
          //     chatId: selectedConversation.chatId,
          //     conversation_id: result.conversationId,
          //     vehicle: selectedConversation.vehicle,
          //     message_id: result.messageId,
          //   };
          //   onMessageSentOrReceived(tempMessage, result.conversationId);
          // }
          console.log("Message sent successfully, waiting for WebSocket confirmation.");
        } else {
          setSendError(result.error || "Échec de l'envoi du message")
        }
      } catch (err: any) {
        setSendError(err.message || "Erreur lors de l'envoi du message")
      } finally {
        setSendingMessage(false)
      }
    },
    [selectedConversation, user, onMessageSentOrReceived], // Keep dependencies as they are used in the function
  )

  // Function to add a new message received via WebSocket
  const addIncomingMessage = useCallback(
    (message: AppMessage) => {
      console.log("🔍 addIncomingMessage called with:", JSON.stringify(message, null, 2))
      console.log("🔍 selectedConversation:", selectedConversation)
      console.log("🔍 selectedConversation.id:", selectedConversation?.id)
      console.log("🔍 message.conversation_id:", message.conversation_id)
      
      if (selectedConversation && message.conversation_id === selectedConversation.id) {
        console.log("✅ Message belongs to selected conversation, adding to messages...")
        setMessagesForSelectedChat((prev) => {
          console.log("🔍 Current messages count:", prev.length)
          
          // Avoid duplicates
          const isDuplicate = prev.some((m) => m.id === message.id || (m.message_id && m.message_id === message.message_id))
          if (isDuplicate) {
            console.log("⚠️ Duplicate message detected, skipping...")
            return prev
          }
          
          const newMessages = [...prev, message].sort((a, b) => a.timestamp - b.timestamp)
          console.log("✅ Message added! New messages count:", newMessages.length)
          return newMessages
        })
      } else {
        console.log("❌ Message does not belong to selected conversation or no conversation selected")
        console.log("❌ Condition check:")
        console.log("   - selectedConversation exists:", !!selectedConversation)
        console.log("   - message.conversation_id === selectedConversation.id:", message.conversation_id === selectedConversation?.id)
      }
    },
    [selectedConversation],
  )

  // Fonction pour rafraîchir manuellement les messages
  const refreshMessages = useCallback(() => {
    if (selectedConversation?.id) {
      fetchMessagesForChat(selectedConversation.id)
    }
  }, [selectedConversation?.id, fetchMessagesForChat])

  return {
    messagesForSelectedChat,
    loadingMessages,
    sendingMessage,
    sendError,
    isRefreshing,
    fetchMessagesForChat,
    handleSendMessage,
    addIncomingMessage,
    refreshMessages,
    setMessagesForSelectedChat, // Expose setter if direct manipulation is needed from parent
  }
}
