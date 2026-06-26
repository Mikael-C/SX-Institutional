const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Loan = sequelize.define('Loan', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('Lend', 'Borrow'),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    interestRate: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 5.0
    },
    yieldEarned: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('Active', 'Closed'),
      defaultValue: 'Active'
    }
  }, {
    tableName: 'loans',
    indexes: [
      { fields: ['userId'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['userId', 'status'] }
    ]
  });

  return Loan;
};
