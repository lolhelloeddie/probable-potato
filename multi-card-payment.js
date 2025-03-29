class Card {
  constructor(cardNumber, cardName, expiryDate, cvv, availableBalance, currency = "USD") {
    this.cardNumber = cardNumber;
    this.cardName = cardName;
    this.expiryDate = expiryDate;
    this.cvv = cvv;
    this.availableBalance = parseFloat(availableBalance.toFixed(2));
    this.currency = currency;
    this.token = this.generateToken(); // For security, generate a token rather than using raw card data
  }

  generateToken() {
    // In a real implementation, this would call a secure tokenization service
    return "tok_" + this.cardNumber.slice(-4) + "_" + Math.random().toString(36).substring(2, 10);
  }

  isExpired() {
    const [month, year] = this.expiryDate.split('/');
    const expiryDate = new Date(2000 + parseInt(year), parseInt(month) - 1, 1);
    return expiryDate < new Date();
  }

  validateCard() {
    // Basic Luhn algorithm for credit card validation
    let sum = 0;
    let shouldDouble = false;
    // Remove any non-digit characters
    const digits = this.cardNumber.replace(/\D/g, '');
    
    // Loop through digits in reverse
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits.charAt(i));
      
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    
    return (sum % 10) === 0;
  }

  charge(amount) {
    amount = parseFloat(amount.toFixed(2)); // Ensure proper decimal handling for currency
    
    if (amount <= 0) {
      return { success: false, message: "Amount must be greater than zero" };
    }
    
    if (this.isExpired()) {
      return { success: false, message: "Card is expired", amountCharged: 0 };
    }
    
    if (!this.validateCard()) {
      return { success: false, message: "Invalid card number", amountCharged: 0 };
    }
    
    if (amount > this.availableBalance) {
      return { 
        success: false, 
        message: "Insufficient funds", 
        amountCharged: 0,
        remainingBalance: this.availableBalance
      };
    }
    
    this.availableBalance = parseFloat((this.availableBalance - amount).toFixed(2));
    return { 
      success: true, 
      message: "Payment successful", 
      amountCharged: amount,
      remainingBalance: this.availableBalance,
      token: this.token // Return token instead of raw card data
    };
  }
}

class MultiCardPaymentProcessor {
  constructor() {
    this.registeredCards = [];
    this.transactionHistory = [];
    this.paymentProfiles = {};
  }
  
  registerCard(card) {
    this.registeredCards.push(card);
    return this.registeredCards.length - 1; // Return card index
  }
  
  savePaymentProfile(profileName, cardIndices, splitRatio = null) {
    if (cardIndices.length === 0 || cardIndices.length > 3) {
      return { success: false, message: "Please provide between 1 and 3 cards" };
    }
    
    // Validate card indices
    for (const index of cardIndices) {
      if (index < 0 || index >= this.registeredCards.length) {
        return { success: false, message: `Invalid card index: ${index}` };
      }
    }
    
    this.paymentProfiles[profileName] = {
      cardIndices: cardIndices,
      splitRatio: splitRatio, // null means use sequential charging
      dateCreated: new Date().toISOString()
    };
    
    return { 
      success: true, 
      message: `Payment profile "${profileName}" saved successfully` 
    };
  }
  
  generateTransactionId() {
    return 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  }
  
  async processPayment(totalAmount, cardIndices = [], customSplitAmounts = null, profileName = null) {
    // Create transaction record
    const transactionId = this.generateTransactionId();
    const timestamp = new Date().toISOString();
    
    // Ensure proper decimal handling for currency
    totalAmount = parseFloat(totalAmount.toFixed(2));
    
    // Log transaction start
    console.log(`[${timestamp}] Transaction ${transactionId} started for amount ${totalAmount}`);
    
    // Use payment profile if provided
    if (profileName) {
      const profile = this.paymentProfiles[profileName];
      if (!profile) {
        return { 
          success: false, 
          message: `Payment profile "${profileName}" not found`,
          transactionId
        };
      }
      
      cardIndices = profile.cardIndices;
      if (profile.splitRatio && !customSplitAmounts) {
        // Calculate split amounts based on ratio
        customSplitAmounts = profile.splitRatio.map(ratio => 
          parseFloat((totalAmount * ratio).toFixed(2))
        );
        
        // Adjust for rounding errors to ensure sum equals total
        const sum = customSplitAmounts.reduce((a, b) => a + b, 0);
        const diff = totalAmount - sum;
        customSplitAmounts[0] += diff;
      }
    }
    
    // Validate input
    if (totalAmount <= 0) {
      const error = { success: false, message: "Total amount must be greater than zero", transactionId };
      this.logTransaction(transactionId, "FAILED", error.message, totalAmount, [], []);
      return error;
    }
    
    if (cardIndices.length === 0 || cardIndices.length > 3) {
      const error = { success: false, message: "Please provide between 1 and 3 cards", transactionId };
      this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
      return error;
    }
    
    // Validate card indices
    for (const index of cardIndices) {
      if (index < 0 || index >= this.registeredCards.length) {
        const error = { success: false, message: `Invalid card index: ${index}`, transactionId };
        this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
        return error;
      }
    }
    
    // Selected cards for this transaction
    const selectedCards = cardIndices.map(index => this.registeredCards[index]);
    
    // Validate all cards first
    for (let i = 0; i < selectedCards.length; i++) {
      const card = selectedCards[i];
      if (card.isExpired()) {
        const error = { 
          success: false, 
          message: `Card ${i+1} (${card.token}) is expired`, 
          transactionId 
        };
        this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
        return error;
      }
      
      if (!card.validateCard()) {
        const error = { 
          success: false, 
          message: `Card ${i+1} (${card.token}) has an invalid number`, 
          transactionId 
        };
        this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
        return error;
      }
    }
    
    // Calculate total available balance across all selected cards
    const totalAvailableBalance = selectedCards.reduce(
      (sum, card) => sum + card.availableBalance, 0
    );
    
    if (totalAvailableBalance < totalAmount) {
      const error = { 
        success: false, 
        message: "Insufficient funds across all provided cards",
        totalAvailable: totalAvailableBalance,
        transactionId
      };
      this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
      return error;
    }
    
    // Simulate async payment processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const charges = [];
    let remainingAmount = totalAmount;
    
    // If custom split amounts are provided, use them
    if (customSplitAmounts) {
      if (customSplitAmounts.length !== cardIndices.length) {
        const error = { 
          success: false, 
          message: "Number of split amounts must match number of cards",
          transactionId
        };
        this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
        return error;
      }
      
      // Ensure proper decimal handling for currency
      customSplitAmounts = customSplitAmounts.map(amount => parseFloat(amount.toFixed(2)));
      
      const sumOfSplits = customSplitAmounts.reduce((sum, amount) => sum + amount, 0);
      if (Math.abs(sumOfSplits - totalAmount) > 0.01) { // Allow for small floating point differences
        const error = { 
          success: false, 
          message: `Sum of split amounts (${sumOfSplits}) does not equal total amount (${totalAmount})`,
          transactionId
        };
        this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, customSplitAmounts);
        return error;
      }
      
      // Charge each card with its custom amount
      for (let i = 0; i < selectedCards.length; i++) {
        const chargeAmount = customSplitAmounts[i];
        const chargeResult = selectedCards[i].charge(chargeAmount);
        
        if (!chargeResult.success) {
          // Refund any already charged cards
          for (let j = 0; j < i; j++) {
            selectedCards[j].availableBalance = parseFloat(
              (selectedCards[j].availableBalance + customSplitAmounts[j]).toFixed(2)
            );
          }
          
          const error = { 
            success: false, 
            message: `Failed to charge card ${i+1}: ${chargeResult.message}`,
            partialCharges: charges,
            transactionId
          };
          this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, customSplitAmounts);
          return error;
        }
        
        charges.push({
          cardIndex: cardIndices[i],
          cardToken: chargeResult.token,
          amountCharged: chargeAmount,
          remainingBalance: chargeResult.remainingBalance,
          currency: selectedCards[i].currency
        });
      }
    } else {
      // Default behavior: charge cards in sequence until the total amount is covered
      for (let i = 0; i < selectedCards.length; i++) {
        const card = selectedCards[i];
        const chargeAmount = parseFloat(Math.min(remainingAmount, card.availableBalance).toFixed(2));
        
        if (chargeAmount > 0) {
          const chargeResult = card.charge(chargeAmount);
          
          if (!chargeResult.success) {
            // Refund any already charged cards
            for (let j = 0; j < i; j++) {
              const refundAmount = charges[j].amountCharged;
              selectedCards[j].availableBalance = parseFloat(
                (selectedCards[j].availableBalance + refundAmount).toFixed(2)
              );
            }
            
            const error = { 
              success: false, 
              message: `Failed to charge card ${i+1}: ${chargeResult.message}`,
              partialCharges: charges,
              transactionId
            };
            this.logTransaction(transactionId, "FAILED", error.message, totalAmount, cardIndices, []);
            return error;
          }
          
          charges.push({
            cardIndex: cardIndices[i],
            cardToken: chargeResult.token,
            amountCharged: chargeAmount,
            remainingBalance: chargeResult.remainingBalance,
            currency: card.currency
          });
          
          remainingAmount = parseFloat((remainingAmount - chargeAmount).toFixed(2));
          
          if (remainingAmount <= 0) {
            break;
          }
        }
      }
    }
    
    const result = {
      success: true,
      message: "Payment processed successfully",
      transactionId: transactionId,
      timestamp: timestamp,
      totalAmount: totalAmount,
      charges: charges
    };
    
    this.logTransaction(transactionId, "SUCCESS", "Payment processed successfully", totalAmount, cardIndices, charges);
    
    return result;
  }
  
  logTransaction(transactionId, status, message, amount, cardIndices, charges) {
    const transaction = {
      transactionId,
      status,
      message,
      amount,
      cardIndices,
      charges,
      timestamp: new Date().toISOString()
    };
    
    this.transactionHistory.push(transaction);
    console.log(`[${transaction.timestamp}] Transaction ${transactionId} ${status}: ${message}`);
    
    return transaction;
  }
  
  getTransactionHistory() {
    return this.transactionHistory;
  }
  
  getTransaction(transactionId) {
    return this.transactionHistory.find(t => t.transactionId === transactionId);
  }
  
  async refundTransaction(transactionId) {
    const transaction = this.getTransaction(transactionId);
    
    if (!transaction) {
      return { success: false, message: `Transaction ${transactionId} not found` };
    }
    
    if (transaction.status !== "SUCCESS") {
      return { success: false, message: `Cannot refund failed transaction ${transactionId}` };
    }
    
    // Process refunds for each charge
    for (const charge of transaction.charges) {
      if (charge.cardIndex >= 0 && charge.cardIndex < this.registeredCards.length) {
        const card = this.registeredCards[charge.cardIndex];
        card.availableBalance = parseFloat((card.availableBalance + charge.amountCharged).toFixed(2));
      }
    }
    
    // Create refund transaction record
    const refundTransactionId = this.generateTransactionId();
    this.logTransaction(
      refundTransactionId, 
      "REFUND", 
      `Refund for transaction ${transactionId}`, 
      transaction.amount, 
      transaction.cardIndices, 
      transaction.charges
    );
    
    // Update original transaction
    transaction.status = "REFUNDED";
    transaction.refundTransactionId = refundTransactionId;
    
    return { 
      success: true, 
      message: `Transaction ${transactionId} refunded successfully`,
      refundTransactionId
    };
  }
}
}

// Example usage
function demonstratePaymentSystem() {
  // Create a payment processor
  const processor = new MultiCardPaymentProcessor();
  
  // Register some cards
  const card1 = new Card("1234-5678-9012-3456", "John Doe", "12/25", "123", 500);
  const card2 = new Card("2345-6789-0123-4567", "Jane Smith", "01/26", "456", 300);
  const card3 = new Card("3456-7890-1234-5678", "Bob Johnson", "03/24", "789", 200);
  
  const card1Index = processor.registerCard(card1);
  const card2Index = processor.registerCard(card2);
  const card3Index = processor.registerCard(card3);
  
  console.log("Example 1: Charge $700 across 3 cards using default sequential charging");
  const result1 = processor.processPayment(700, [card1Index, card2Index, card3Index]);
  console.log(JSON.stringify(result1, null, 2));
  
  // Reset card balances for the next example
  card1.availableBalance = 500;
  card2.availableBalance = 300;
  card3.availableBalance = 200;
  
  console.log("\nExample 2: Charge $700 with custom split amounts");
  const result2 = processor.processPayment(700, [card1Index, card2Index, card3Index], [350, 250, 100]);
  console.log(JSON.stringify(result2, null, 2));
  
  // Reset card balances for the next example
  card1.availableBalance = 500;
  card2.availableBalance = 300;
  card3.availableBalance = 200;
  
  console.log("\nExample 3: Try to charge more than available balance");
  const result3 = processor.processPayment(1200, [card1Index, card2Index, card3Index]);
  console.log(JSON.stringify(result3, null, 2));
}

// Run the demonstration
demonstratePaymentSystem();